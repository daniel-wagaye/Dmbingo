import { gameSql } from '../db/drizzle';
import { activeRoom } from '../colyseus/GameRoom';
import { isBotTelegramId } from '../constants/bots';

/**
 * Boards held by humans in the current room. Bots are excluded.
 * Returns null if there is no room, so the caller can leave games.real_p unset.
 */
function countHumanBoards(): number | null {
  if (!activeRoom) return null;

  let count = 0;
  activeRoom.state.picks.forEach((pick) => {
    const id = Number(pick.telegramId);
    if (id > 0 && !isBotTelegramId(id)) count++;
  });
  return count;
}

/**
 * Best-effort write of human board count. Never throws, never retries, never
 * blocks the caller. A failed UPDATE leaves games.real_p NULL.
 */
export function startRecordHumanBoards(gameId: number): void {
  const count = countHumanBoards();
  const id = Number(gameId);
  if (count === null || !Number.isFinite(id) || id <= 0) return;

  void gameSql`
    UPDATE games
    SET real_p = ${count}::smallint
    WHERE game_id = ${id}::bigint
  `
    .then(() => {
      console.log(`[real_p] Game ${id}: ${count} human board(s)`);
    })
    .catch((err) => {
      console.error(`[real_p] Game ${id} update failed:`, err);
    });
}
