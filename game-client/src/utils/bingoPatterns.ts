/**
 * Check if a 5x5 bingo card has a winning pattern given called numbers.
 * Card is number[][] (5 rows x 5 cols). Center (2,2) is always free.
 * Patterns: horizontal, vertical, diagonal, four corners.
 */
export function hasBingoPattern(card: number[][], calledSet: Set<number>): boolean {
  const isMarked = (r: number, c: number): boolean => {
    if (r === 2 && c === 2) return true; // FREE
    return calledSet.has(card[r][c]);
  };

  // Horizontal lines
  for (let r = 0; r < 5; r++) {
    let rowWin = true;
    for (let c = 0; c < 5; c++) {
      if (!isMarked(r, c)) { rowWin = false; break; }
    }
    if (rowWin) return true;
  }

  // Vertical lines
  for (let c = 0; c < 5; c++) {
    let colWin = true;
    for (let r = 0; r < 5; r++) {
      if (!isMarked(r, c)) { colWin = false; break; }
    }
    if (colWin) return true;
  }

  // Main diagonal (top-left to bottom-right)
  let diag1 = true;
  for (let i = 0; i < 5; i++) {
    if (!isMarked(i, i)) { diag1 = false; break; }
  }
  if (diag1) return true;

  // Anti-diagonal (top-right to bottom-left)
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
