import { callPickBoard } from '../services/gameService';
import { activeRoom, GameRoom } from '../colyseus/GameRoom';
import { BOT_TELEGRAM_IDS, randomBotName } from '../constants/bots';

const TOTAL_BOARDS = 500;
const FIRST_HALF_SHARE = 0.7;
const MIN_PICK_GAP_MS = 300;
const FIRST_PICK_DELAY_MS = 300;
// Leave room before the countdown expires so a pick never lands on the transition.
const END_SAFETY_MS = 500;
// Below this the picks cannot be spread out sensibly, so the game runs without bots.
const MIN_WINDOW_MS = 3000;

let botTimers: Array<ReturnType<typeof setTimeout>> = [];
let scheduledGameId = 0;
// Boards handed to pick_board() but not yet confirmed, so two bots never race for one.
const inFlightBoards = new Set<number>();

export function stopBotPicks(): void {
  for (const timer of botTimers) clearTimeout(timer);
  botTimers = [];
  inFlightBoards.clear();
  scheduledGameId = 0;
}

export interface BotGameParams {
  gameId: number;
  phase: string;
  pickingEndsAt: string | number | Date | null | undefined;
  botStatus?: string | null;
  minBotAmount?: number | string | null;
  maxBotAmount?: number | string | null;
}

export function startBotPicksForGame(params: BotGameParams): void {
  stopBotPicks();

  if (params.phase !== 'picking') return;
  if (String(params.botStatus ?? '').toLowerCase() !== 'on') return;

  const gameId = Number(params.gameId);
  if (!Number.isFinite(gameId) || gameId <= 0) {
    console.warn('[botManager] Missing game id — skipping bots for this game.');
    return;
  }

  const endsAt = toEpochMs(params.pickingEndsAt);
  if (!endsAt) return;

  const maxBots = Math.min(toCount(params.maxBotAmount), BOT_TELEGRAM_IDS.length);
  const minBots = Math.min(toCount(params.minBotAmount), maxBots);
  if (maxBots <= 0) return;

  const total = randomInt(minBots, maxBots);
  if (total <= 0) return;

  const now = Date.now();
  const windowStart = now + FIRST_PICK_DELAY_MS;
  const windowEnd = endsAt - END_SAFETY_MS;
  if (windowEnd - windowStart < MIN_WINDOW_MS) {
    console.warn(
      `[botManager] Picking window too short (${Math.max(endsAt - now, 0)}ms) — skipping bots for game ${gameId}.`
    );
    return;
  }

  const halfway = clamp(now + (endsAt - now) / 2, windowStart, windowEnd);
  const firstCount = Math.round(total * FIRST_HALF_SHARE);
  const secondCount = total - firstCount;

  const firstTimes = spreadTimes(firstCount, windowStart, halfway);
  // Keep the gap across the halfway boundary too, not just inside each half.
  const lastFirst = firstTimes[firstTimes.length - 1];
  const secondStart = clamp(
    lastFirst === undefined ? halfway : Math.max(halfway, lastFirst + MIN_PICK_GAP_MS),
    windowStart,
    windowEnd
  );
  const times = [...firstTimes, ...spreadTimes(secondCount, secondStart, windowEnd)];

  const botIds = shuffle(BOT_TELEGRAM_IDS).slice(0, total);
  scheduledGameId = gameId;

  times.forEach((at, i) => {
    const delay = Math.max(at - Date.now(), 0);
    botTimers.push(
      setTimeout(() => {
        void runBotPick(botIds[i], gameId);
      }, delay)
    );
  });

  console.log(
    `[botManager] Game ${gameId}: ${total} bots (${firstCount} in first half, ${secondCount} in second) over ${Math.round((windowEnd - windowStart) / 1000)}s`
  );
}

async function runBotPick(botTelegramId: number, gameId: number): Promise<void> {
  if (!isCurrentPickingGame(gameId)) return;

  const boardId = pickFreeBoard(activeRoom!);
  if (!boardId) return;

  inFlightBoards.add(boardId);
  try {
    const result = await callPickBoard(botTelegramId, boardId);

    // A bot never retries: any rejection (taken board, low balance, closed picking)
    // simply means one fewer bot in this game.
    if (!result || result.success !== true || result.action !== 'pick') return;

    // The room may already have moved on to the next game while the query ran.
    if (activeRoom && activeRoom.state.gameId === gameId) {
      activeRoom.updatePick(boardId, botTelegramId, false, randomBotName());
    }
  } catch (err: any) {
    console.warn(
      `[botManager] Bot ${botTelegramId} failed to pick board ${boardId}:`,
      err?.message ?? err
    );
  } finally {
    inFlightBoards.delete(boardId);
  }
}

function isCurrentPickingGame(gameId: number): boolean {
  if (!activeRoom) return false;
  if (scheduledGameId !== gameId) return false;
  return activeRoom.state.phase === 'picking' && activeRoom.state.gameId === gameId;
}

function pickFreeBoard(room: GameRoom): number | null {
  const free: number[] = [];
  for (let id = 1; id <= TOTAL_BOARDS; id++) {
    if (inFlightBoards.has(id)) continue;
    if (room.state.picks.has(id.toString())) continue;
    free.push(id);
  }
  if (free.length === 0) return null;
  return free[Math.floor(Math.random() * free.length)];
}

/**
 * Random timestamps inside [startMs, endMs], at least MIN_PICK_GAP_MS apart.
 * If the window cannot hold that gap, spacing shrinks so every pick still fits.
 */
function spreadTimes(count: number, startMs: number, endMs: number): number[] {
  if (count <= 0) return [];

  const span = Math.max(endMs - startMs, 0);
  if (count === 1) return [startMs + Math.random() * span];

  const gap = Math.min(MIN_PICK_GAP_MS, span / (count - 1));
  // Consume only part of the leftover time so the last pick does not always
  // land exactly on the window edge.
  const slack = (span - gap * (count - 1)) * (0.85 + Math.random() * 0.15);

  const weights = Array.from({ length: count }, () => Math.random());
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

  const times: number[] = [];
  let cursor = startMs;
  for (let i = 0; i < count; i++) {
    cursor += (i === 0 ? 0 : gap) + (weights[i] / weightSum) * slack;
    times.push(cursor);
  }
  return times;
}

function toEpochMs(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toCount(value: number | string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
