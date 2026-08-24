import type { User } from '../services/userService';

// Africa/Addis_Ababa is fixed at UTC+3 (no DST), matching the server's streak boundaries.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MILESTONES = [5, 10, 30] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Calendar date in EAT as `YYYY-MM-DD`, offset by whole days. */
export function eatDate(offsetDays = 0, nowMs: number = Date.now()): string {
  return new Date(nowMs + EAT_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export interface StreakInfo {
  /** Today's EAT date, resolved from server time. Also the stamp used by the pop-up markers. */
  today: string;
  /** Streak the UI shows: 0 once the streak is broken, otherwise the stored count. */
  streak: number;
  playedToday: boolean;
  /** Streak is still alive: the last game was today or yesterday. */
  alive: boolean;
  /**
   * A milestone was reached by a game played *today*. Drives the gold button, the modal's
   * reward state and the confetti — a milestone earned on an earlier day is shown normally.
   */
  isBonusDay: boolean;
  reached: Record<Milestone, boolean>;
  nextMilestone: Milestone | null;
  daysToNext: number | null;
}

export function deriveStreak(user: User | null, nowMs: number): StreakInfo {
  const today = eatDate(0, nowMs);
  const yesterday = eatDate(-1, nowMs);
  const lastPlay = user?.last_play_date ? user.last_play_date.slice(0, 10) : null;

  const playedToday = lastPlay === today;
  // Playing yesterday keeps the streak alive: it still counts and grows on the next game.
  const alive = playedToday || lastPlay === yesterday;

  const raw = Number(user?.streak_count ?? 0);
  const rawStreak = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;

  // A missed day means the streak is gone. The server only clears it on the next finished
  // game, so the stored count is stale here and showing 0 is the honest state.
  const streak = alive ? rawStreak : 0;

  const isBonusDay = playedToday && (MILESTONES as readonly number[]).includes(streak);

  const reached: Record<Milestone, boolean> = {
    5: alive && user?.streak_bonus_5_received === true,
    10: alive && user?.streak_bonus_10_received === true,
    30: alive && user?.streak_bonus_30_received === true,
  };

  const nextMilestone = MILESTONES.find((m) => m > streak) ?? null;

  return {
    today,
    streak,
    playedToday,
    alive,
    isBonusDay,
    reached,
    nextMilestone,
    daysToNext: nextMilestone === null ? null : nextMilestone - streak,
  };
}

/**
 * Local-storage markers for the two automatic pop-ups. Both hold an EAT date (`YYYY-MM-DD`) so
 * they expire on their own at midnight, and both are scoped per user so a shared device does not
 * suppress another player's modal.
 */
function markerKey(kind: 'open' | 'bonus', telegramId: number | null | undefined): string | null {
  if (!telegramId) return null;
  return kind === 'open' ? `streak_opened_on:${telegramId}` : `streak_bonus_shown_on:${telegramId}`;
}

export function wasShownOn(
  kind: 'open' | 'bonus',
  telegramId: number | null | undefined,
  today: string
): boolean {
  const key = markerKey(kind, telegramId);
  if (!key) return false;
  try {
    return localStorage.getItem(key) === today;
  } catch {
    // Private-mode storage failures must never block the dashboard; treat as "not shown".
    return false;
  }
}

export function markShownOn(
  kind: 'open' | 'bonus',
  telegramId: number | null | undefined,
  today: string
): void {
  const key = markerKey(kind, telegramId);
  if (!key) return;
  try {
    localStorage.setItem(key, today);
  } catch {
    // Ignore quota/permission errors — the modal simply reappears on the next open.
  }
}
