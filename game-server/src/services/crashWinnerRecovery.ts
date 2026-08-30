import {
  callFinalizeGame,
  getCreditedWinners,
  getLatestGame,
  getPlayerPicksForGame,
  insertErrorDocuments,
  type ErrorDocumentRow,
  type GamePickRow,
} from './gameService';
import { clearWinners, readWinners } from './winnerRecoveryStore';
import { sendCrashRecoveryMessages, type RecoveryWinner } from './crashRecoveryNotifier';

/**
 * Runs once at startup, before the normal recovery function.
 *
 * recover_game_state() decides what to do from Postgres alone. A game that crashed between
 * winner detection and finalize_game still looks like a started game with no winners there, so
 * it would refund every player and quietly cancel a real win. This settles those games first,
 * using the winner snapshot the caller wrote to the SSD, and leaves the database in
 * winner_reveal so the existing recovery can finish the cycle exactly as it always does.
 *
 * Every other situation is a no-op: recovery behaves as before.
 */

export interface SettleOutcome {
  /** True only when a crashed game was paid out from the SSD record. */
  settled: boolean;
  gameId: number | null;
}

const NOTHING_TO_SETTLE: SettleOutcome = { settled: false, gameId: null };

export async function settleWinnersFromDisk(): Promise<SettleOutcome> {
  const game = await getLatestGame();
  if (!game) return NOTHING_TO_SETTLE;

  const gameId = Number(game.game_id);
  // Only a game still marked 'started' can have an unfinalized payout. Anything else has
  // already passed finalize_game, so a leftover file must never be replayed.
  if (game.phase !== 'started') return { settled: false, gameId };

  const record = await readWinners(gameId);
  if (!record) {
    console.log(
      `[crashWinners] Game ${gameId} was interrupted while running with no winner on disk. ` +
        'Standard recovery will refund the players.'
    );
    return { settled: false, gameId };
  }

  const boardIds = record.winners.map((w) => w.board_id);
  console.warn(
    `[crashWinners] Game ${gameId} crashed after ${boardIds.length} winner(s) were accepted. ` +
      `Finalizing from disk: ${JSON.stringify(boardIds)} (stored_at=${record.stored_at})`
  );

  // Read the participants before finalizing: the documentation must cover everyone who
  // played, and later steps must not depend on rows recovery is about to touch.
  let picks: GamePickRow[] = [];
  try {
    picks = await getPlayerPicksForGame(gameId);
  } catch (err) {
    console.error(`[crashWinners] Could not read player_picks for game ${gameId}:`, err);
  }

  // Same 30-retry wrapper the live finalization path uses.
  const result = await callFinalizeGame(boardIds);
  if (!result?.success) {
    console.error(
      `[crashWinners] finalize_game refused game ${gameId}. Handing over to standard recovery.`,
      result
    );
    return { settled: false, gameId };
  }
  console.log(`[crashWinners] finalize_game result for game ${gameId}:`, result);

  // The payout is committed. Everything below is bookkeeping — a failure here must not stop
  // the server from coming up, so each part is isolated.
  await documentAndNotify(gameId, game, picks, record.winners.map((w) => w.board_id));

  await clearWinners(gameId);

  return { settled: true, gameId };
}

async function documentAndNotify(
  gameId: number,
  game: any,
  picks: GamePickRow[],
  winnerBoardIds: number[]
): Promise<void> {
  const winnerBoards = new Set(winnerBoardIds);
  const stake = Number(game.stake_amount ?? 0).toFixed(2);
  const totalPrize = Number(game.prize_amount ?? 0).toFixed(2);

  try {
    const documents: ErrorDocumentRow[] = picks.map((p) => ({
      game_id: gameId,
      telegram_id: p.telegram_id,
      stake,
      board_id: p.board_id,
      winner: winnerBoards.has(p.board_id),
    }));
    const written = await insertErrorDocuments(documents);
    console.log(`[crashWinners] Documented ${written} board(s) of game ${gameId} in error_documents.`);
  } catch (err) {
    console.error(
      `[crashWinners] Could not write error_documents for game ${gameId}. The payout still went through.`,
      err
    );
  }

  try {
    const credited = await getCreditedWinners(gameId);
    const nameByBoard = new Map(picks.map((p) => [p.board_id, p.winner_name]));
    const winners: RecoveryWinner[] = credited.map((c) => ({
      telegram_id: c.telegram_id,
      board_id: c.board_id,
      amount: c.credited_amount,
      name: nameByBoard.get(c.board_id) || 'Player',
    }));

    if (winners.length === 0) {
      console.warn(`[crashWinners] Game ${gameId} has no credited winners to announce.`);
      return;
    }

    // Fire-and-forget: startup must not wait on Telegram.
    void sendCrashRecoveryMessages(gameId, picks, winners, totalPrize).catch((err) =>
      console.error(`[crashWinners] Notification batch for game ${gameId} failed:`, err)
    );
  } catch (err) {
    console.error(`[crashWinners] Could not build notifications for game ${gameId}:`, err);
  }
}
