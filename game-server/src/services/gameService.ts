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
        SELECT stake_amount, picking_countdown_end_time, minimum_player
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
      return inserted[0];
    });
  }, 'create_new_picking_game');
}

