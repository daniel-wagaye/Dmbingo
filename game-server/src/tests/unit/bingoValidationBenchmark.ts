import { getBingoCard, hasBingoPattern } from '../../services/bingoValidator';

type ScenarioResult = {
  scenario: string;
  boardsChecked: number;
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

function runScenario(name: string, calledSet: Set<number>, rounds = DEFAULT_ROUNDS): ScenarioResult {
  let winnersFound = 0;

  const memoryBefore = process.memoryUsage();
  const startedAt = process.hrtime.bigint();

  for (let round = 0; round < rounds; round++) {
    for (const boardId of BOARD_IDS) {
      const card = getBingoCard(boardId);
      if (!card) {
        throw new Error(`Card not loaded for board ${boardId}`);
      }
      if (hasBingoPattern(card, calledSet)) {
        winnersFound++;
      }
    }
  }

  const elapsedNs = process.hrtime.bigint() - startedAt;
  const memoryAfter = process.memoryUsage();
  const totalChecks = BOARD_IDS.length * rounds;
  const averageMsPerRound = Number(elapsedNs) / 1e6 / rounds;

  return {
    scenario: name,
    boardsChecked: BOARD_IDS.length,
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
    runScenario('10_called_numbers', buildCalledSet(10)),
    runScenario('20_called_numbers', buildCalledSet(20)),
    runScenario('40_called_numbers', buildCalledSet(40)),
    runScenario('60_called_numbers', buildCalledSet(60)),
    runScenario('75_called_numbers', buildCalledSet(75)),
  ];

  console.log('Bingo validation benchmark');
  console.table(results);
}

main();
