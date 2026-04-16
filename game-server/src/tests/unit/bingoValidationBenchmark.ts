import { getBingoCard, hasBingoPattern } from '../../services/bingoValidator';

type ScenarioResult = {
  scenario: string;
  boardsChecked: number;
  autoBoardsChecked: number;
  rounds: number;
  totalChecks: number;
  averageMsPerRound: number;
  averageMsPerBoard: number;
  winnersFound: number;
  heapDeltaKb: number;
  rssDeltaKb: number;
};

const BOARD_IDS = Array.from({ length: 500 }, (_, index) => index + 1);
const DEFAULT_ROUNDS = 5000;

type PickState = {
  telegramId: number;
  winner: boolean;
  winnerName: string;
  auto: boolean;
};

type AutoBoard = {
  boardId: number;
  telegramId: number;
};

function toKb(bytes: number): number {
  return Number((bytes / 1024).toFixed(2));
}

function buildCalledSet(calledCount: number): Set<number> {
  return new Set(Array.from({ length: calledCount }, (_, index) => index + 1));
}

function assertCardsLoaded(): void {
  for (const boardId of BOARD_IDS) {
    if (!getBingoCard(boardId)) {
      throw new Error(`Missing bingo card for board ${boardId}`);
    }
  }
}

function createPicks(autoEnabled: boolean): Map<string, PickState> {
  const picks = new Map<string, PickState>();
  for (const boardId of BOARD_IDS) {
    const playerIndex = Math.floor((boardId - 1) / 2) + 1;
    picks.set(boardId.toString(), {
      telegramId: playerIndex,
      winner: false,
      winnerName: `Player ${playerIndex}`,
      auto: autoEnabled,
    });
  }
  return picks;
}

function getAutoBoards(picks: Map<string, PickState>): AutoBoard[] {
  const result: AutoBoard[] = [];
  picks.forEach((pick, key) => {
    if (pick.auto && !pick.winner) {
      result.push({
        boardId: Number(key),
        telegramId: pick.telegramId,
      });
    }
  });
  return result;
}

function runAutoBingoScan(calledCount: number, autoBoards: AutoBoard[], picks: Map<string, PickState>): number {
  const shuffledNums = Array.from({ length: 75 }, (_, index) => index + 1);
  const calledSet = new Set<number>();
  for (let i = 0; i < calledCount && i < shuffledNums.length; i++) {
    calledSet.add(shuffledNums[i]);
  }

  let winnersFound = 0;
  for (const { boardId, telegramId } of autoBoards) {
    const card = getBingoCard(boardId);
    if (!card) {
      throw new Error(`Card not loaded for board ${boardId}`);
    }

    if (hasBingoPattern(card, calledSet)) {
      const pick = picks.get(boardId.toString());
      if (!pick) {
        throw new Error(`Pick not loaded for board ${boardId}`);
      }
      pick.telegramId = telegramId;
      pick.winner = true;
      winnersFound++;
    }
  }

  return winnersFound;
}

function runScenario(name: string, calledCount: number, rounds = DEFAULT_ROUNDS): ScenarioResult {
  let winnersFound = 0;
  const autoBoardsChecked = BOARD_IDS.length;

  const memoryBefore = process.memoryUsage();
  const startedAt = process.hrtime.bigint();

  for (let round = 0; round < rounds; round++) {
    const picks = createPicks(true);
    const autoBoards = getAutoBoards(picks);
    winnersFound += runAutoBingoScan(calledCount, autoBoards, picks);
  }

  const elapsedNs = process.hrtime.bigint() - startedAt;
  const memoryAfter = process.memoryUsage();
  const totalChecks = autoBoardsChecked * rounds;
  const averageMsPerRound = Number(elapsedNs) / 1e6 / rounds;

  return {
    scenario: name,
    boardsChecked: BOARD_IDS.length,
    autoBoardsChecked,
    rounds,
    totalChecks,
    averageMsPerRound: Number(averageMsPerRound.toFixed(6)),
    averageMsPerBoard: Number((averageMsPerRound / BOARD_IDS.length).toFixed(8)),
    winnersFound,
    heapDeltaKb: toKb(memoryAfter.heapUsed - memoryBefore.heapUsed),
    rssDeltaKb: toKb(memoryAfter.rss - memoryBefore.rss),
  };
}

function main(): void {
  assertCardsLoaded();

  const results = [
    runScenario('auto_bingo_10_called_numbers', 10),
    runScenario('auto_bingo_20_called_numbers', 20),
    runScenario('auto_bingo_40_called_numbers', 40),
    runScenario('auto_bingo_60_called_numbers', 60),
    runScenario('auto_bingo_75_called_numbers', 75),
  ];

  console.log('Auto bingo validation benchmark');
  console.table(results);
}

main();
