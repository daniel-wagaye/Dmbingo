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
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

async function persistCallingStarted(gameId: number): Promise<void> {
  const maxAttempts = 12;
  const timeoutPerAttemptMs = Math.max(config.callingIntervalMs, 1500);
  const retryDelayMs = Math.min(Math.max(config.callingIntervalMs, 500), 2000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (activeGameId !== gameId || winnerDetected) return;
    try {
      await withTimeout(setCallingStarted(gameId), timeoutPerAttemptMs, 'set_calling_started');
      console.log(`[caller] Game ${gameId}: calling_started = true`);
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error(`[caller] Game ${gameId}: failed to persist calling_started after ${maxAttempts} attempts`, err);
        return;
      }
      await sleep(retryDelayMs);
    }
  }
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

  setTimeout(() => {
    if (activeGameId !== gameId) return;

    if (activeRoom) {
      activeRoom.setCallingStarted();
    }

    scheduleNextTick(gameId);
    void persistCallingStarted(gameId);
  }, config.callingStartDelayMs);
}
