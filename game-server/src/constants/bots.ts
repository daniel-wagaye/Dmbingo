// NPC/bot accounts. The matching user rows were seeded with:
//   INSERT INTO users (telegram_id, username, first_name)
//   SELECT 10000000 + i, 'bot' || i, 'b' || i FROM generate_series(1, 100) AS i;
export const BOT_TELEGRAM_IDS: number[] = Array.from(
  { length: 100 },
  (_, i) => 10000000 + i + 1
);

const BOT_TELEGRAM_ID_SET = new Set<number>(BOT_TELEGRAM_IDS);

export function isBotTelegramId(telegramId: number): boolean {
  return BOT_TELEGRAM_ID_SET.has(Number(telegramId));
}

// Names shown for bots in the room. A name is drawn at random on every bot pick,
// so it is never tied to a specific bot telegram id.
export const BOT_NAMES: string[] = [
  'Abel',
  'Bereket',
  'Chaltu',
  'Dawit',
  'Eyob',
  'Fikir',
  'Hanna',
  'Kalkidan',
  'Lemlem',
  'Mekdes',
  'Nahom',
  'Robel',
  'Selam',
  'Tigist',
  'Yonas',
];

export function randomBotName(): string {
  if (BOT_NAMES.length === 0) return '';
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}
