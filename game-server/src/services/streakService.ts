import { userSql } from '../db/drizzle';
import { activeRoom } from '../colyseus/GameRoom';
import { isBotTelegramId } from '../constants/bots';
import { sendStreakBonusMessages, StreakBonusTier } from './streakNotifier';

const EAT_TIME_ZONE = 'Africa/Addis_Ababa';
const MAX_DB_ATTEMPTS = 5;
const DB_RETRY_DELAY_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface StreakBonusGroup {
  amount: string | number | null;
  telegram_ids: number[] | null;
}

interface StreakUpdateResult {
  updated_ids: number[] | null;
  failed_ids: number[] | null;
  bonus_5: StreakBonusGroup | null;
  bonus_10: StreakBonusGroup | null;
  bonus_30: StreakBonusGroup | null;
}

const BONUS_TIERS: Array<{ key: 'bonus_5' | 'bonus_10' | 'bonus_30'; tier: StreakBonusTier }> = [
  { key: 'bonus_5', tier: '5_days' },
  { key: 'bonus_10', tier: '10_days' },
  { key: 'bonus_30', tier: '30_days' },
];

const eatDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EAT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function eatDateKey(): string {
  return eatDateFormatter.format(new Date());
}

/**
 * Telegram ids already streak-updated today (EAT). Local to this process, which is
 * fine on a single instance: the PG function is idempotent per day, so a cache miss
 * after a restart costs one redundant query, never a double credit.
 */
class DailyStreakCache {
  private dateKey = '';
  private ids = new Set<number>();

  private rollover(): void {
    const today = eatDateKey();
    if (today !== this.dateKey) {
      this.dateKey = today;
      this.ids.clear();
    }
  }

  has(telegramId: number): boolean {
    this.rollover();
    return this.ids.has(Number(telegramId));
  }

  add(telegramIds: number[]): void {
    this.rollover();
    for (const id of telegramIds) this.ids.add(Number(id));
  }

  filterUncached(telegramIds: number[]): number[] {
    this.rollover();
    return telegramIds.filter((id) => !this.ids.has(Number(id)));
  }
}

export const streakCache = new DailyStreakCache();

/**
 * Distinct human players holding a board in the room right now, sorted ascending.
 * Bots have real user rows but must not earn streak bonuses.
 */
export function collectPlayerTelegramIds(): number[] {
  if (!activeRoom) return [];

  const ids = new Set<number>();
  activeRoom.state.picks.forEach((pick) => {
    const id = Number(pick.telegramId);
    if (id > 0 && !isBotTelegramId(id)) ids.add(id);
  });

  return [...ids].sort((a, b) => a - b);
}

async function callUpdateStreaksForUsers(telegramIds: number[]): Promise<StreakUpdateResult | null> {
  const rows = await userSql`
    SELECT update_streaks_for_users(${telegramIds}::bigint[]) AS result
  `;
  return (rows[0]?.result as StreakUpdateResult) ?? null;
}

// Runs are chained so two games starting back to back never contend for the same rows.
let queue: Promise<void> = Promise.resolve();

/**
 * Fire-and-forget entry point: updates streaks for the given players in the
 * background. Never throws and never blocks the caller.
 */
export function startStreakUpdate(telegramIds: number[]): void {
  if (telegramIds.length === 0) return;
  queue = queue
    .then(() => runStreakUpdate(telegramIds))
    .catch((err) => console.error('[streak] Background update failed:', err));
}

async function runStreakUpdate(candidateIds: number[]): Promise<void> {
  let pending = streakCache.filterUncached(candidateIds);
  if (pending.length === 0) {
    console.log(`[streak] All ${candidateIds.length} player(s) already updated today — skipping.`);
    return;
  }

  console.log(`[streak] Updating ${pending.length}/${candidateIds.length} player(s)`);

  const winners = new Map<StreakBonusTier, { amount: string; ids: Set<number> }>();

  for (let attempt = 1; attempt <= MAX_DB_ATTEMPTS && pending.length > 0; attempt++) {
    if (attempt > 1) await sleep(DB_RETRY_DELAY_MS);

    try {
      const result = await callUpdateStreaksForUsers(pending);
      if (!result) {
        console.error(`[streak] Attempt ${attempt}/${MAX_DB_ATTEMPTS} returned no result.`);
        continue; // retry the same batch
      }

      const updated = toIdArray(result.updated_ids);
      if (updated.length > 0) streakCache.add(updated);
      collectWinners(result, winners);

      // Only the rows the function could not process are worth another attempt.
      pending = toIdArray(result.failed_ids);
      if (pending.length > 0) {
        console.warn(
          `[streak] Attempt ${attempt}/${MAX_DB_ATTEMPTS}: ${pending.length} id(s) failed, retrying those.`
        );
      }
    } catch (err) {
      // Whole call failed — keep the batch intact and try again.
      console.error(`[streak] Attempt ${attempt}/${MAX_DB_ATTEMPTS} failed:`, err);
    }
  }

  if (pending.length > 0) {
    console.error(
      `[streak] Giving up on ${pending.length} id(s) after ${MAX_DB_ATTEMPTS} attempts:`,
      pending
    );
  }

  await notifyWinners(winners);
}

function collectWinners(
  result: StreakUpdateResult,
  winners: Map<StreakBonusTier, { amount: string; ids: Set<number> }>
): void {
  for (const { key, tier } of BONUS_TIERS) {
    const group = result[key];
    const ids = toIdArray(group?.telegram_ids);
    if (ids.length === 0) continue;

    const entry = winners.get(tier) ?? { amount: String(group?.amount ?? '0'), ids: new Set<number>() };
    for (const id of ids) entry.ids.add(id);
    winners.set(tier, entry);
  }
}

async function notifyWinners(
  winners: Map<StreakBonusTier, { amount: string; ids: Set<number> }>
): Promise<void> {
  for (const { tier } of BONUS_TIERS) {
    const entry = winners.get(tier);
    if (!entry || entry.ids.size === 0) continue;
    try {
      await sendStreakBonusMessages(tier, entry.amount, [...entry.ids]);
    } catch (err) {
      console.error(`[streak] Notification batch for ${tier} failed:`, err);
    }
  }
}

function toIdArray(value: number[] | null | undefined): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((id) => Number.isFinite(id));
}
