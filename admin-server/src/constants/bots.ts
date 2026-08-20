// NPC/bot accounts. Must stay in sync with game-server/src/constants/bots.ts — the
// matching user rows were seeded with:
//   INSERT INTO users (telegram_id, username, first_name)
//   SELECT 10000000 + i, 'bot' || i, 'b' || i FROM generate_series(1, 100) AS i;
// Bots hold real user rows and can win games, so every leaderboard aggregation must
// filter them out before counting, ranking, or saving a snapshot.
export const BOT_TELEGRAM_IDS: number[] = Array.from(
  { length: 100 },
  (_, i) => 10000000 + i + 1
);

const BOT_TELEGRAM_ID_SET = new Set<number>(BOT_TELEGRAM_IDS);

export const isBotTelegramId = (telegramId: number): boolean =>
  BOT_TELEGRAM_ID_SET.has(Number(telegramId));
