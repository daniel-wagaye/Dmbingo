// Inside your Express POST /api/games/pick handler
const result = await db.execute(sql`SELECT pick_board(${telegramId}, ${boardId})`);
if (result.success) {
  // After successful DB transaction, broadcast to all players
  const room = gameServer.getRoom('game_room');
  room?.broadcast('pick_update', {
    boardId,
    telegramId,
    action: result.action // 'pick' | 'unpick' | 'move'
  });
}
res.json(result);