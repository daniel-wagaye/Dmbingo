import { config } from '../config';
import {
  callFinalizeGame,
  callCreateNextGame,
  getLatestGame,
} from '../services/gameService';
import { schedulePickingTimer } from './scheduler';
import { startBotPicksForGame } from './botManager';
import { activeRoom } from '../colyseus/GameRoom';
import { getBingoCard, hasBingoPattern } from '../services/bingoValidator';
import { clearWinners, saveWinners } from '../services/winnerRecoveryStore';
import { raiseAlert, resolveAlert } from '../services/alerter';
import {
  classifyCreateNextResult,
  classifyFinalizeResult,
  delayForAttempt,
  errorText,
} from './criticalRetry';

let callingInterval: ReturnType<typeof setInterval> | null = null;
let activeGameId: number | null = null;
let currentIndex = 0;
let totalNums = 75;
let winnerDetected = false;
let acceptanceTimer: ReturnType<typeof setTimeout> | null = null;
let finalizeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let createNextRetryTimer: ReturnType<typeof setTimeout> | null = null;
let revealTimer: ReturnType<typeof setTimeout> | null = null;

// `finalizing` stays true from the first finalize attempt until create_next_game succeeds,
// so a late claim cannot open a second acceptance window. `finalizeInFlight` is only true
// while a DB call is awaited, so the retry timer can re-enter.
let finalizing = false;
let finalizeInFlight = false;
let createNextRunning = false;
let finalizeAttempts = 0;
let createNextAttempts = 0;
let lockedWinnerBoardIds: number[] | null = null;

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

function haltCalling(): void {
  if (callingInterval) {
    clearInterval(callingInterval);
    callingInterval = null;
  }
  acceptanceTimer = clearTimer(acceptanceTimer);
}

export function stopCallingLoop(): void {
  haltCalling();
  finalizeRetryTimer = clearTimer(finalizeRetryTimer);
  createNextRetryTimer = clearTimer(createNextRetryTimer);
  revealTimer = clearTimer(revealTimer);
  activeGameId = null;
  currentIndex = 0;
  winnerDetected = false;
  finalizing = false;
  finalizeInFlight = false;
  createNextRunning = false;
  finalizeAttempts = 0;
  createNextAttempts = 0;
  lockedWinnerBoardIds = null;
}

export function getActiveGameId(): number | null {
  return activeGameId;
}

/** True once payout has started. Claims must not add winners or start another finalize. */
export function isFinalizing(): boolean {
  return finalizing;
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
  if (!activeRoom || finalizing) return;
  const gameId = currentGameId();
  if (!gameId) return;
  const winners = activeRoom.getWinnerEntries();
  if (winners.length === 0) return;
  void saveWinners(gameId, winners);
}

export function onWinnerDetected(): void {
  persistWinnerSnapshot();
  if (finalizing) return;
  if (winnerDetected) return;
  winnerDetected = true;

  haltCalling();

  console.log(
    `[caller] Winner detected for game ${activeGameId}. Starting ${config.winnerAcceptanceWindowMs}ms acceptance window.`
  );

  acceptanceTimer = setTimeout(() => {
    acceptanceTimer = null;
    void runFinalization();
  }, config.winnerAcceptanceWindowMs);
}

function scheduleFinalizeRetry(gameId: number): void {
  finalizeRetryTimer = clearTimer(finalizeRetryTimer);
  const delay = delayForAttempt(Math.max(finalizeAttempts - 1, 0));
  console.warn(
    `[caller] finalize_game for game ${gameId} will retry in ${delay}ms (attempt ${finalizeAttempts}).`
  );
  finalizeRetryTimer = setTimeout(() => {
    finalizeRetryTimer = null;
    void runFinalization();
  }, delay);
}

function scheduleCreateNextRetry(gameId: number): void {
  createNextRetryTimer = clearTimer(createNextRetryTimer);
  const delay = delayForAttempt(Math.max(createNextAttempts - 1, 0));
  console.warn(
    `[caller] create_next_game for game ${gameId} will retry in ${delay}ms (attempt ${createNextAttempts}).`
  );
  createNextRetryTimer = setTimeout(() => {
    createNextRetryTimer = null;
    void runCreateNext(gameId);
  }, delay);
}

async function latestGameOrNull(): Promise<any | null> {
  try {
    return await getLatestGame();
  } catch (err) {
    console.error('[caller] getLatestGame failed while classifying a transition:', err);
    return null;
  }
}

export async function runFinalization(): Promise<void> {
  if (finalizeInFlight) return;
  if (createNextRunning || revealTimer) return;

  finalizeInFlight = true;
  finalizing = true;
  winnerDetected = true;
  haltCalling();

  const gameId = currentGameId();
  try {
    if (!lockedWinnerBoardIds) {
      lockedWinnerBoardIds = activeRoom ? activeRoom.getWinnerBoardIds() : [];
    }
    const winnerBoardIds = lockedWinnerBoardIds;
    console.log(
      `[caller] Finalizing game ${gameId}... winnerBoardIds=${JSON.stringify(winnerBoardIds)}`
    );

    if (gameId && winnerBoardIds.length > 0 && activeRoom) {
      await saveWinners(gameId, activeRoom.getWinnerEntries());
    }

    const result = await callFinalizeGame(winnerBoardIds);
    console.log('[caller] finalize_game result:', result);

    const latest = result?.success === true ? null : await latestGameOrNull();
    const decision = classifyFinalizeResult(result, latest, gameId);

    if (decision === 'retry') {
      finalizeAttempts++;
      raiseAlert(
        `finalize:${gameId || 'unknown'}`,
        `finalize_game failed for game ${gameId}`,
        {
          operation: 'finalize_game',
          game_id: gameId,
          attempt: finalizeAttempts,
          winner_boards: winnerBoardIds,
          error: result?.error ?? 'no_success',
          phase: result?.phase ?? latest?.phase,
        }
      );
      scheduleFinalizeRetry(gameId);
      return;
    }

    resolveAlert(
      `finalize:${gameId || 'unknown'}`,
      `finalize_game succeeded for game ${gameId}`,
      { game_id: gameId, winner_boards: winnerBoardIds, decision }
    );

    if (gameId) void clearWinners(gameId);

    if (decision === 'already_finalized') {
      const row = latest ?? (await latestGameOrNull());
      if (row && Number(row.game_id) !== gameId) {
        console.warn(
          `[caller] Game ${gameId} was already replaced by game ${row.game_id} (${row.phase}). Syncing room.`
        );
        applyGameRow(row);
        stopCallingLoop();
        return;
      }
      if (row && row.phase !== 'winner_reveal' && row.phase !== 'finished' && row.phase !== 'started') {
        applyGameRow(row);
        stopCallingLoop();
        return;
      }
    }

    beginWinnerReveal(gameId);
  } catch (err) {
    finalizeAttempts++;
    console.error('[caller] finalize_game failed:', err);
    raiseAlert(
      `finalize:${gameId || 'unknown'}`,
      `finalize_game failed for game ${gameId}`,
      {
        operation: 'finalize_game',
        game_id: gameId,
        attempt: finalizeAttempts,
        winner_boards: lockedWinnerBoardIds,
        error: errorText(err),
      }
    );
    scheduleFinalizeRetry(gameId);
  } finally {
    finalizeInFlight = false;
  }
}

function beginWinnerReveal(gameId: number): void {
  const revealEndsAtMs = Date.now() + config.winnerRevealDurationMs;
  if (activeRoom) {
    activeRoom.setWinnerReveal(revealEndsAtMs);
  }
  scheduleRevealEnd(gameId);
}

function scheduleRevealEnd(gameId: number): void {
  if (revealTimer) return;
  console.log(`[caller] Winner reveal for ${config.winnerRevealDurationMs}ms`);
  revealTimer = setTimeout(() => {
    revealTimer = null;
    void runCreateNext(gameId);
  }, config.winnerRevealDurationMs);
}

async function runCreateNext(gameId: number): Promise<void> {
  if (createNextRunning) return;
  createNextRunning = true;
  try {
    const nextGame = await callCreateNextGame();
    console.log('[caller] create_next_game returned:', nextGame);

    if (classifyCreateNextResult(nextGame) === 'retry') {
      createNextAttempts++;
      raiseAlert(
        `create_next:${gameId || 'unknown'}`,
        `create_next_game failed for game ${gameId}`,
        {
          operation: 'create_next_game',
          previous_game_id: gameId,
          attempt: createNextAttempts,
          error: nextGame?.error ?? 'empty_or_invalid_result',
        }
      );
      scheduleCreateNextRetry(gameId);
      return;
    }

    resolveAlert(
      `create_next:${gameId || 'unknown'}`,
      `create_next_game succeeded after game ${gameId}`,
      { previous_game_id: gameId, new_game_id: nextGame?.game_id, phase: nextGame?.phase }
    );

    applyCreatedGame(nextGame);
    stopCallingLoop();
  } catch (err) {
    createNextAttempts++;
    console.error('[caller] create_next_game failed:', err);
    raiseAlert(
      `create_next:${gameId || 'unknown'}`,
      `create_next_game failed for game ${gameId}`,
      {
        operation: 'create_next_game',
        previous_game_id: gameId,
        attempt: createNextAttempts,
        error: errorText(err),
      }
    );
    scheduleCreateNextRetry(gameId);
  } finally {
    createNextRunning = false;
  }
}

function applyCreatedGame(nextGame: any): void {
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

function applyGameRow(game: any): void {
  if (activeRoom) {
    activeRoom.setNewGame({
      phase: game.phase || 'maintenance',
      game_id: game.game_id ? Number(game.game_id) : 0,
      picking_ends_at: game.picking_ends_at || null,
      stake_amount: game.stake_amount ? Number(game.stake_amount) : 0,
      minimum_player: game.minimum_player ? Number(game.minimum_player) : 0,
    });
  }

  if (game.phase === 'picking' && game.picking_ends_at) {
    const delay = new Date(game.picking_ends_at).getTime() - Date.now();
    schedulePickingTimer(Math.max(delay, 0));
  }
}

function checkAutoBingo(): void {
  if (!activeRoom || winnerDetected || finalizing) return;

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

  console.log(
    `[caller] Starting calling loop for game ${gameId}. ${config.callingStartDelayMs}ms loading delay...`
  );

  setTimeout(async () => {
    if (activeGameId !== gameId) return;

    try {
      if (activeRoom) {
        activeRoom.setCallingStarted();
      }
      console.log(`[caller] Game ${gameId}: callingStarted = true (Colyseus only)`);

      callingInterval = setInterval(async () => {
        if (winnerDetected || finalizing || activeGameId !== gameId) {
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
