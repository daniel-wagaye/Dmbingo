import { config } from '../config';
import {
  callFinalizeGame,
  callCreateNextGame,
} from '../services/gameService';
import { schedulePickingTimer } from './scheduler';
import { startBotPicksForGame } from './botManager';
import { activeRoom } from '../colyseus/GameRoom';
import { getBingoCard, hasBingoPattern } from '../services/bingoValidator';
import { clearWinners, saveWinners } from '../services/winnerRecoveryStore';

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

export function getActiveGameId(): number | null {
  return activeGameId;
}

/** Game the winners belong to. `activeGameId` is authoritative; room state is the fallback. */
function currentGameId(): number {
  if (activeGameId) return activeGameId;
  return activeRoom ? Number(activeRoom.state.gameId) : 0;
}

/**
 * Snapshots every winner known right now to the SSD. Fire-and-forget: the store serializes
 * and retries internally, and a disk problem must not delay the acceptance window.
 */
function persistWinnerSnapshot(): void {
  if (!activeRoom) return;
  const gameId = currentGameId();
  if (!gameId) return;
  const winners = activeRoom.getWinnerEntries();
  if (winners.length === 0) return;
  void saveWinners(gameId, winners);
}

export function onWinnerDetected(): void {
  // Runs on every detection, not just the first, so winners that arrive later in the
  // acceptance window are persisted too. Each write is a complete snapshot.
  persistWinnerSnapshot();

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
  // stopCallingLoop() clears activeGameId, so capture it while it is still set.
  const gameId = currentGameId();
  try {
    const winnerBoardIds = activeRoom ? activeRoom.getWinnerBoardIds() : [];
    console.log(`[caller] Finalizing game ${gameId}... winnerBoardIds=${JSON.stringify(winnerBoardIds)}`);

    // The file must describe exactly what is about to be finalized, so this last snapshot is
    // awaited. saveWinners never throws — it logs and reports failure — so a bad disk delays
    // finalization by at most three quick attempts instead of blocking the game.
    if (gameId && winnerBoardIds.length > 0 && activeRoom) {
      await saveWinners(gameId, activeRoom.getWinnerEntries());
    }

    const result = await callFinalizeGame(winnerBoardIds);
    console.log('[caller] finalize_game result:', result);

    // Payout is committed and the phase has moved past 'started', so the snapshot can no
    // longer be replayed and is removed.
    if (gameId && result?.success) {
      void clearWinners(gameId);
    }

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

        startBotPicksForGame({
          gameId: nextGame.game_id ? Number(nextGame.game_id) : 0,
          phase: nextGame.phase,
          pickingEndsAt: nextGame.picking_ends_at,
          botStatus: nextGame.bot_status,
          minBotAmount: nextGame.min_bot_amount,
          maxBotAmount: nextGame.max_bot_amount,
        });
      }
    } catch (err) {
      console.error('[caller] create_next_game failed after all retries:', err);
    }
  }, config.winnerRevealDurationMs);
}

function checkAutoBingo(): void {
  if (!activeRoom || winnerDetected) return;

  const state = activeRoom.state;
  const shuffled = state.shuffledNums;
  const ci = state.calledIndex;
  if (ci < 4) return; // minimum 4 numbers needed for four corners

  const calledSet = new Set<number>();
  for (let i = 0; i < ci && i < shuffled.length; i++) {
    calledSet.add(shuffled[i]);
  }

  const autoBoards = activeRoom.getAutoBoards();
  let foundWinner = false;

  for (const { boardId, telegramId } of autoBoards) {
    const card = getBingoCard(boardId);
    if (!card) continue;

    if (hasBingoPattern(card, calledSet)) {
      const pick = state.picks.get(boardId.toString());
      const winnerName = pick?.winnerName || '';
      activeRoom.updatePick(boardId, telegramId, true, winnerName);
      foundWinner = true;
    }
  }

  if (foundWinner) {
    onWinnerDetected();
  }
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

        checkAutoBingo();

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