import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import seedrandom from 'seedrandom';

// Configuration
const TOTAL_CARDS = 500;
const SEED = 'dmbingo-fixed-seed-2025'; // Change this to regenerate a different set
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_JSON = path.join(__dirname, 'bingoCards.json');
const OUTPUT_SQL = path.join(__dirname, 'seed_player_picks.sql');

// Column definitions
const COLUMNS = [
  { name: 'B', min: 1, max: 15 },
  { name: 'I', min: 16, max: 30 },
  { name: 'N', min: 31, max: 45 },
  { name: 'G', min: 46, max: 60 },
  { name: 'O', min: 61, max: 75 },
];

// Helper: generate a random integer between min and max (inclusive)
function randomInt(rng: seedrandom.PRNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// Helper: generate an array of `count` distinct numbers from a range
function distinctNumbers(rng: seedrandom.PRNG, min: number, max: number, count: number): number[] {
  if (max - min + 1 < count) {
    throw new Error(`Range [${min},${max}] cannot provide ${count} distinct numbers`);
  }
  const result: number[] = [];
  while (result.length < count) {
    const candidate = randomInt(rng, min, max);
    if (!result.includes(candidate)) {
      result.push(candidate);
    }
  }
  return result;
}

// Main generation
function generateCards() {
  const rng = seedrandom(SEED); // deterministic random generator
  const cards: Record<number, number[][]> = {};

  for (let boardId = 1; boardId <= TOTAL_CARDS; boardId++) {
    // Build the card column by column
    const card: number[][] = [[], [], [], [], []]; // 5 rows, each will have 5 numbers

    for (let col = 0; col < 5; col++) {
      const { min, max } = COLUMNS[col];
      // Get 5 distinct numbers for this column
      const colNumbers = distinctNumbers(rng, min, max, 5);

      // For column N (index 2), replace the center cell (row 2) with 0 (FREE)
      if (col === 2) {
        colNumbers[2] = 0; // row index 2 = third row
      }

      // Place numbers into the card: each row gets the number from this column
      for (let row = 0; row < 5; row++) {
        card[row][col] = colNumbers[row];
      }
    }

    cards[boardId] = card;
  }

  return cards;
}

// Write JSON file (for frontend)
function writeJson(cards: Record<number, number[][]>) {
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(cards, null, 2));
  console.log(`✅ JSON written to ${OUTPUT_JSON}`);
}

// Write SQL file (for seeding the database)
function writeSql(cards: Record<number, number[][]>) {
  const lines: string[] = [];
  lines.push(`-- Seed data for player_picks (${TOTAL_CARDS} cards)`);
  lines.push(`INSERT INTO player_picks (board_id, bingo_card, withdrawal_used, non_withdrawal_used, winner, invalid) VALUES`);

  const values: string[] = [];
  for (let boardId = 1; boardId <= TOTAL_CARDS; boardId++) {
    const cardJson = JSON.stringify(cards[boardId]);
    // PostgreSQL requires proper escaping of single quotes inside JSON – we use jsonb literal
    values.push(`(${boardId}, '${cardJson}'::jsonb, 0, 0, false, false)`);
  }
  lines.push(values.join(',\n'));
  lines.push(';');

  fs.writeFileSync(OUTPUT_SQL, lines.join('\n'));
  console.log(`✅ SQL written to ${OUTPUT_SQL}`);
}

// Run
const cards = generateCards();
writeJson(cards);
writeSql(cards);
