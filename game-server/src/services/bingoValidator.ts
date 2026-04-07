import bingoCardsJson from '../BingoCards/bingoCards.json';

// In-memory bingo card data: boardId -> 5x5 number grid
const bingoCards: Map<number, number[][]> = new Map();

// Load all 500 cards into memory on import
const raw = bingoCardsJson as Record<string, number[][]>;
for (const [key, card] of Object.entries(raw)) {
  bingoCards.set(Number(key), card);
}
console.log(`[bingoValidator] Loaded ${bingoCards.size} bingo cards into memory.`);

export function getBingoCard(boardId: number): number[][] | undefined {
  return bingoCards.get(boardId);
}

/**
 * Check if a 5x5 bingo card has a winning pattern given a set of called numbers.
 * Center cell (row 2, col 2) is always FREE (stored as 0 in JSON).
 * Patterns: horizontal line, vertical line, diagonal, four corners.
 */
export function hasBingoPattern(card: number[][], calledSet: Set<number>): boolean {
  const isMarked = (r: number, c: number): boolean => {
    if (r === 2 && c === 2) return true; // FREE space
    return calledSet.has(card[r][c]);
  };

  // Horizontal lines
  for (let r = 0; r < 5; r++) {
    let win = true;
    for (let c = 0; c < 5; c++) {
      if (!isMarked(r, c)) { win = false; break; }
    }
    if (win) return true;
  }

  // Vertical lines
  for (let c = 0; c < 5; c++) {
    let win = true;
    for (let r = 0; r < 5; r++) {
      if (!isMarked(r, c)) { win = false; break; }
    }
    if (win) return true;
  }

  // Main diagonal
  let diag1 = true;
  for (let i = 0; i < 5; i++) {
    if (!isMarked(i, i)) { diag1 = false; break; }
  }
  if (diag1) return true;

  // Anti-diagonal
  let diag2 = true;
  for (let i = 0; i < 5; i++) {
    if (!isMarked(i, 4 - i)) { diag2 = false; break; }
  }
  if (diag2) return true;

  // Four corners
  if (isMarked(0, 0) && isMarked(0, 4) && isMarked(4, 0) && isMarked(4, 4)) {
    return true;
  }

  return false;
}
