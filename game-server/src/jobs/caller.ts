import { config } from '../config';
import {
  updateCalledIndex,
  setCallingStarted,
  callFinalizeGame,
  callCreateNextGame,
} from '../services/gameService';
import { schedulePickingTimer } from './scheduler';
import { activeRoom } from '../colyseus/GameRoom';

let callingTimer: ReturnType<typeof setTimeout> | null = null;
let activeGameId: number | null = null;
let currentIndex = 0;
let totalNums = 75;
let winnerDetected = false;
let acceptanceTimer: ReturnType<typeof setTimeout> | null = null;

export function stopCallingLoop(): void {
  if (callingTimer) {
    clearTimeout(callingTimer);
    callingTimer = null;
  }
  if (acceptanceTimer) {
    clearTimeout(acceptanceTimer);
    acceptanceTimer = null;
  }
  activeGameId = null;
  currentIndex = 0;
  winnerDetected = false;
}

export function onWinnerDetected(): void {
  if (winnerDetected) return;
  winnerDetected = true;

  if (callingTimer) {
    clearTimeout(callingTimer);
    callingTimer = null;
  }

  console.log(`[caller] Winner detected for game ${activeGameId}. Starting ${config.winnerAcceptanceWindowMs}ms acceptance window.`);

  acceptanceTimer = setTimeout(async () => {
    acceptanceTimer = null;
    await runFinalization();
  }, config.winnerAcceptanceWindowMs);
}

async function runFinalization(): Promise<void> {
  try {
    console.log(`[caller] Finalizing game ${activeGameId}...`);
    // callFinalizeGame has 30-retry inside gameService
    const result = await callFinalizeGame();
    console.log('[caller] finalize_game result:', result);

    stopCallingLoop();

    const revealEndsAtMs = Date.now() + config.winnerRevealDurationMs;
    if (activeRoom) {
      activeRoom.setWinnerReveal(revealEndsAtMs);
    }

    scheduleRevealEnd();
  } catch (err) {
    console.error('[caller] finalize_game failed after all retries:', err);
    stopCallingLoop();
  }
}

function scheduleRevealEnd(): void {
  console.log(`[caller] Winner reveal for ${config.winnerRevealDurationMs}ms`);

  setTimeout(async () => {
    try {
      // callCreateNextGame has 30-retry inside gameService
      const nextGame = await callCreateNextGame();
      console.log('[caller] create_next_game returned:', nextGame);

      if (nextGame) {
        if (activeRoom) {
          activeRoom.setNewGame({
            phase: nextGame.phase || 'maintenance',
            game_id: nextGame.game_id ? Number(nextGame.game_id) : 0,
            picking_ends_at: nextGame.picking_ends_at || null,
            stake_amount: nextGame.stake_amount ? Number(nextGame.stake_amount) : 0,
          });
        }

        if (nextGame.phase === 'picking' && nextGame.picking_ends_at) {
          const delay = new Date(nextGame.picking_ends_at).getTime() - Date.now();
          schedulePickingTimer(Math.max(delay, 0));
        }
      }
    } catch (err) {
      console.error('[caller] create_next_game failed after all retries:', err);
    }
  }, config.winnerRevealDurationMs);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_TIMEOUT`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function scheduleNextTick(gameId: number): void {
  if (winnerDetected || activeGameId !== gameId) return;
  callingTimer = setTimeout(() => {
    void runTick(gameId);
  }, config.callingIntervalMs);
}

async function runTick(gameId: number): Promise<void> {
  if (winnerDetected || activeGameId !== gameId) {
    if (callingTimer) {
      clearTimeout(callingTimer);
      callingTimer = null;
    }
    return;
  }

  currentIndex++;
  if (currentIndex > totalNums) {
    if (callingTimer) {
      clearTimeout(callingTimer);
      callingTimer = null;
    }
    console.log(`[caller] All 75 numbers called for game ${gameId}. Finalizing (no winner).`);
    await runFinalization();
    return;
  }

  try {
    await updateCalledIndex(gameId, currentIndex);
    if (activeRoom) {
      activeRoom.setCalledIndex(currentIndex);
    }
  } catch (err) {
    console.error(`[caller] Failed to persist called_index ${currentIndex} after all retries:`, err);
  }

  scheduleNextTick(gameId);
}

export function startCallingLoop(gameId: number, _shuffledNums: number[]): void {
  stopCallingLoop();

  activeGameId = gameId;
  currentIndex = 0;
  totalNums = 75;
  winnerDetected = false;

  console.log(`[caller] Starting calling loop for game ${gameId}. ${config.callingStartDelayMs}ms loading delay...`);

  setTimeout(async () => {
    if (activeGameId !== gameId) return;

    const startupTimeoutMs = Math.max(config.callingIntervalMs * 2, 8000);
    try {
      await withTimeout(setCallingStarted(gameId), startupTimeoutMs, 'set_calling_started');
      console.log(`[caller] Game ${gameId}: calling_started = true`);
    } catch (err) {
      console.error('[caller] set_calling_started startup stalled. Continuing caller loop:', err);
      void setCallingStarted(gameId).then(
        () => console.log(`[caller] Game ${gameId}: calling_started persisted on delayed retry`),
        (retryErr) => console.error('[caller] set_calling_started delayed retry failed:', retryErr)
      );
    }

    if (activeRoom) {
      activeRoom.setCallingStarted();
    }

    scheduleNextTick(gameId);
  }, config.callingStartDelayMs);
}
