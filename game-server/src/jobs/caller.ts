import { config } from '../config';
import {
  callFinalizeGame,
  callCreateNextGame,
} from '../services/gameService';
import { schedulePickingTimer } from './scheduler';
import { activeRoom } from '../colyseus/GameRoom';

let callingInterval: ReturnType<typeof setInterval> | null = null;
let activeGameId: number | null = null;
let currentIndex = 0;
let totalNums = 75;
let winnerDetected = false;
let acceptanceTimer: ReturnType<typeof setTimeout> | null = null;

export function stopCallingLoop(): void {
  if (callingInterval) {
    clearInterval(callingInterval);
    callingInterval = null;
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

  if (callingInterval) {
    clearInterval(callingInterval);
    callingInterval = null;
  }

  console.log(`[caller] Winner detected for game ${activeGameId}. Starting ${config.winnerAcceptanceWindowMs}ms acceptance window.`);

  acceptanceTimer = setTimeout(async () => {
    acceptanceTimer = null;
    await runFinalization();
  }, config.winnerAcceptanceWindowMs);
}

async function runFinalization(): Promise<void> {
  try {
    const winnerBoardIds = activeRoom ? activeRoom.getWinnerBoardIds() : [];
    console.log(`[caller] Finalizing game ${activeGameId}... winnerBoardIds=${JSON.stringify(winnerBoardIds)}`);
    const result = await callFinalizeGame(winnerBoardIds);
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

export function startCallingLoop(gameId: number, _shuffledNums: number[]): void {
  stopCallingLoop();

  activeGameId = gameId;
  currentIndex = 0;
  totalNums = 75;
  winnerDetected = false;

  console.log(`[caller] Starting calling loop for game ${gameId}. ${config.callingStartDelayMs}ms loading delay...`);

  setTimeout(async () => {
    if (activeGameId !== gameId) return;

    try {
      if (activeRoom) {
        activeRoom.setCallingStarted();
      }
      console.log(`[caller] Game ${gameId}: callingStarted = true (Colyseus only)`);

      callingInterval = setInterval(async () => {
        if (winnerDetected || activeGameId !== gameId) {
          if (callingInterval) {
            clearInterval(callingInterval);
            callingInterval = null;
          }
          return;
        }

        if (activeRoom) {
          activeRoom.setCalledIndex(currentIndex);
        }

        currentIndex++;
        if (currentIndex > totalNums) {
          if (callingInterval) {
            clearInterval(callingInterval);
            callingInterval = null;
          }
          console.log(`[caller] All 75 numbers called for game ${gameId}. Finalizing (no winner).`);
          await runFinalization();
          return;
        }
      }, config.callingIntervalMs);
    } catch (err) {
      console.error('[caller] set_calling_started failed after all retries:', err);
      stopCallingLoop();
    }
  }, config.callingStartDelayMs);
}