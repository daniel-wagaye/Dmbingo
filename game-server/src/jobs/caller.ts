import { config } from '../config';
import {
  updateCalledIndex,
  setCallingStarted,
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
    console.log(`[caller] Finalizing game ${activeGameId}...`);
    const result = await callFinalizeGame();
    console.log('[caller] finalize_game result:', result);

    stopCallingLoop();

    // Push winner_reveal to Colyseus room
    const revealEndsAtMs = Date.now() + config.winnerRevealDurationMs;
    if (activeRoom) {
      activeRoom.setWinnerReveal(revealEndsAtMs);
    }

    scheduleRevealEnd();
  } catch (err) {
    console.error('[caller] Error finalizing game:', err);
    stopCallingLoop();
  }
}

function scheduleRevealEnd(): void {
  console.log(`[caller] Winner reveal for ${config.winnerRevealDurationMs}ms`);

  setTimeout(async () => {
    try {
      // create_next_game returns { game_id, phase, picking_ends_at, stake_amount }
      const nextGame = await callCreateNextGame();
      console.log('[caller] create_next_game returned:', nextGame);

      if (nextGame) {
        // Push new game to Colyseus room using return values (no extra DB query)
        if (activeRoom) {
          activeRoom.setNewGame({
            phase: nextGame.phase || 'maintenance',
            picking_ends_at: nextGame.picking_ends_at || null,
            stake_amount: nextGame.stake_amount ? Number(nextGame.stake_amount) : 0,
          });
        }

        // Schedule picking timer using return value directly
        if (nextGame.phase === 'picking' && nextGame.picking_ends_at) {
          const delay = new Date(nextGame.picking_ends_at).getTime() - Date.now();
          schedulePickingTimer(Math.max(delay, 0));
        }
      }
    } catch (err) {
      console.error('[caller] Error creating next game:', err);
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
      await setCallingStarted(gameId);
      console.log(`[caller] Game ${gameId}: calling_started = true`);

      // Push to Colyseus room
      if (activeRoom) {
        activeRoom.setCallingStarted();
      }

      callingInterval = setInterval(async () => {
        if (winnerDetected || activeGameId !== gameId) {
          if (callingInterval) {
            clearInterval(callingInterval);
            callingInterval = null;
          }
          return;
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

        try {
          await updateCalledIndex(gameId, currentIndex);
          // Push called index to Colyseus room
          if (activeRoom) {
            activeRoom.setCalledIndex(currentIndex);
          }
        } catch (err) {
          console.error(`[caller] Error updating called_index to ${currentIndex}:`, err);
        }
      }, config.callingIntervalMs);
    } catch (err) {
      console.error('[caller] Error starting calling:', err);
      stopCallingLoop();
    }
  }, config.callingStartDelayMs);
}