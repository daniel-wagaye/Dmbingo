import { gameSql, queryWithRetry } from '../db/drizzle';

// ── Game pool operations (picks, claims, transitions) ──
// All critical PG functions wrapped with queryWithRetry (30 retries, 300ms base delay)

export async function callPickBoard(telegramId: number, boardId: number): Promise<any> {
  return queryWithRetry(async () => {
    const rows = await gameSql`SELECT pick_board(${telegramId}::bigint, ${boardId}::smallint) AS result`;
    return rows[0]?.result;
  }, 'pick_board');
}

export async function callTransitionPicking(): Promise<any> {
  return queryWithRetry(async () => {
    const rows = await gameSql`SELECT transition_picking() AS result`;
    return rows[0]?.result;
  }, 'transition_picking');
}

export async function callFinalizeGame(winnerBoardIds?: number[]): Promise<any> {
  const ids = winnerBoardIds && winnerBoardIds.length > 0 ? winnerBoardIds : null;
  return queryWithRetry(async () => {
    const rows = await gameSql`SELECT finalize_game(${ids}::smallint[]) AS result`;
    return rows[0]?.result;
  }, 'finalize_game');
}

export async function callCreateNextGame(): Promise<any> {
  return queryWithRetry(async () => {
    const rows = await gameSql`SELECT create_next_game() AS result`;
    return rows[0]?.result ?? null;
  }, 'create_next_game');
}

export async function callRecoverGameState(): Promise<any> {
  return queryWithRetry(async () => {
    const rows = await gameSql`SELECT recover_game_state() AS result`;
    return rows[0]?.result;
  }, 'recover_game_state');
}

export async function getLatestGame(): Promise<any | null> {
  return queryWithRetry(async () => {
    const rows = await gameSql`SELECT * FROM games ORDER BY game_id DESC LIMIT 1`;
    return rows[0] ?? null;
  }, 'get_latest_game');
}

// ── Crash-recovery support (used only on startup) ──

export interface GamePickRow {
  board_id: number;
  telegram_id: number;
  winner_name: string;
}

/** Everyone who played a game, read before recovery so no participant is lost. */
export async function getPlayerPicksForGame(gameId: number): Promise<GamePickRow[]> {
  return queryWithRetry(async () => {
    const rows = await gameSql`
      SELECT board_id, telegram_id, COALESCE(winner_name, '') AS winner_name
      FROM player_picks
      WHERE game_id = ${gameId}::bigint AND telegram_id IS NOT NULL
      ORDER BY board_id
    `;
    return rows.map((r: any) => ({
      board_id: Number(r.board_id),
      telegram_id: Number(r.telegram_id),
      winner_name: String(r.winner_name ?? ''),
    }));
  }, 'get_player_picks_for_game');
}

export interface CreditedWinnerRow {
  telegram_id: number;
  board_id: number;
  credited_amount: string;
}

/**
 * The amounts finalize_game actually credited. Reading them back beats recomputing the
 * cent-splitting rules in JS, which would drift the moment the PG function changes.
 */
export async function getCreditedWinners(gameId: number): Promise<CreditedWinnerRow[]> {
  return queryWithRetry(async () => {
    const rows = await gameSql`
      SELECT telegram_id, board_id, credited_amount
      FROM winners_history
      WHERE game_id = ${gameId}::bigint
      ORDER BY board_id
    `;
    return rows.map((r: any) => ({
      telegram_id: Number(r.telegram_id),
      board_id: Number(r.board_id),
      credited_amount: Number(r.credited_amount ?? 0).toFixed(2),
    }));
  }, 'get_credited_winners');
}

export interface ErrorDocumentRow {
  game_id: number;
  telegram_id: number;
  stake: string;
  board_id: number;
  winner: boolean;
}

/** Single multi-row insert — one round trip regardless of how many boards were in play. */
export async function insertErrorDocuments(rows: ErrorDocumentRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  return queryWithRetry(async () => {
    await gameSql`
      INSERT INTO error_documents ${gameSql(
        rows as any,
        'game_id',
        'telegram_id',
        'stake',
        'board_id',
        'winner'
      )}
    `;
    return rows.length;
  }, 'insert_error_documents');
}

export async function getGameStatus(): Promise<string | null> {
  return queryWithRetry(async () => {
    const rows = await gameSql`SELECT status FROM game_status WHERE id = 1`;
    return rows[0]?.status ?? null;
  }, 'get_game_status');
}

export async function createNewPickingGame(): Promise<any> {
  return queryWithRetry(async () => {
    return await gameSql.begin(async (tx: any) => {
      const lastGameRows = await tx`
        SELECT phase FROM games ORDER BY game_id DESC LIMIT 1 FOR UPDATE
      `;
      if (lastGameRows.length > 0 && lastGameRows[0].phase !== 'maintenance') {
        throw new Error('ALREADY_STARTED');
      }

      const statusRows = await tx`
        SELECT status FROM game_status WHERE id = 1 FOR UPDATE
      `;
      if (!statusRows.length || statusRows[0].status !== 'active') {
        throw new Error('GAME_STATUS_IS_NOT_ACTIVE');
      }

      const configRows = await tx`
        SELECT stake_amount, picking_countdown_end_time, minimum_player,
               bot_status, min_bot_amount, max_bot_amount
        FROM game_config WHERE id = 1
      `;
      if (!configRows.length) throw new Error('CONFIG_MISSING');
      const cfg = configRows[0];

      const inserted = await tx`
        INSERT INTO games (
          phase, calling_started, called_index, active_players,
          picking_ends_at, minimum_player, stake_amount,
          shuffled_nums, prize_amount, house_profit, winner_reveal_ends_at, started_at
        ) VALUES (
          'picking', FALSE, 0, 0,
          NOW() + ${cfg.picking_countdown_end_time}::int * INTERVAL '1 second',
          ${cfg.minimum_player}, ${cfg.stake_amount},
          NULL, NULL, NULL, NULL, NOW()
        ) RETURNING *
      `;
      return {
        ...inserted[0],
        bot_status: cfg.bot_status,
        min_bot_amount: cfg.min_bot_amount,
        max_bot_amount: cfg.max_bot_amount,
      };
    });
  }, 'create_new_picking_game');
}

