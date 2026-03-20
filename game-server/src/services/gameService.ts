import { sql } from '../db/drizzle';

export async function callPickBoard(telegramId: number, boardId: number): Promise<any> {
  const rows = await sql`SELECT pick_board(${telegramId}::bigint, ${boardId}::smallint) AS result`;
  return rows[0]?.result;
}

export async function callTransitionPicking(): Promise<any> {
  const rows = await sql`SELECT transition_picking() AS result`;
  return rows[0]?.result;
}

export async function callClaimBingo(boardId: number, telegramId: number): Promise<any> {
  const rows = await sql`SELECT claim_bingo(${boardId}::smallint, ${telegramId}::bigint) AS result`;
  return (rows[0] as any)?.result;
}

export async function callFinalizeGame(): Promise<any> {
  const rows = await sql`SELECT finalize_game() AS result`;
  return rows[0]?.result;
}

export async function callCreateNextGame(): Promise<any> {
  const rows = await sql`SELECT create_next_game() AS result`;
  return rows[0]?.result ?? null;
}

export async function callRecoverGameState(): Promise<any> {
  const rows = await sql`SELECT recover_game_state() AS result`;
  return rows[0]?.result;
}

export async function getLatestGame(): Promise<any | null> {
  const rows = await sql`SELECT * FROM games ORDER BY game_id DESC LIMIT 1`;
  return rows[0] ?? null;
}

export async function getGameStatus(): Promise<string | null> {
  const rows = await sql`SELECT status FROM game_status WHERE id = 1`;
  return rows[0]?.status ?? null;
}

export async function createNewPickingGame(): Promise<any> {
  return await sql.begin(async (tx: any) => {
    // 1. Lock latest game
    const lastGameRows = await tx`
      SELECT phase FROM games ORDER BY game_id DESC LIMIT 1 FOR UPDATE
    `;
    if (lastGameRows.length > 0 && lastGameRows[0].phase !== 'maintenance') {
      throw new Error('ALREADY_STARTED');
    }

    // 2. Lock game_status
    const statusRows = await tx`
      SELECT status FROM game_status WHERE id = 1 FOR UPDATE
    `;
    if (!statusRows.length || statusRows[0].status !== 'active') {
      throw new Error('GAME_STATUS_IS_NOT_ACTIVE');
    }

    // 3. Read game_config
    const configRows = await tx`
      SELECT stake_amount, picking_countdown_end_time, minimum_player
      FROM game_config WHERE id = 1
    `;
    if (!configRows.length) throw new Error('CONFIG_MISSING');
    const cfg = configRows[0];

    // 4. Insert new game
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
}

export async function updateCalledIndex(gameId: number, newIndex: number): Promise<void> {
  await sql`UPDATE games SET called_index = ${newIndex} WHERE game_id = ${gameId}`;
}

export async function setCallingStarted(gameId: number): Promise<void> {
  await sql`UPDATE games SET calling_started = TRUE WHERE game_id = ${gameId}`;
}