import { config } from '../config';
import {
  syncAllSnapshots,
  syncOneSnapshot,
  type SnapshotPeriod,
  type SnapshotResult,
} from '../services/leaderboardSnapshotService';

// Africa/Addis_Ababa is a fixed UTC+3 offset and has never observed DST.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface LeaderboardSnapshotRuntime {
  timers: NodeJS.Timeout[];
}

const parseHhMm = (value: string, fallbackHour: number, fallbackMinute: number) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return { hour: fallbackHour, minute: fallbackMinute };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return { hour: fallbackHour, minute: fallbackMinute };
  return { hour, minute };
};

/**
 * Next UTC instant whose Africa/Addis_Ababa wall clock is `hour:minute` on a day the
 * predicate accepts. Shifting by the fixed offset makes a Date's UTC getters read as EAT
 * wall-clock fields, so day/weekday arithmetic can be done with plain UTC helpers.
 */
const nextEatRunMs = (
  nowMs: number,
  hour: number,
  minute: number,
  matchesDay: (eatDay: Date) => boolean
): number => {
  const eatNow = new Date(nowMs + EAT_OFFSET_MS);
  for (let offset = 0; offset <= 40; offset++) {
    const candidateEat = new Date(
      Date.UTC(
        eatNow.getUTCFullYear(),
        eatNow.getUTCMonth(),
        eatNow.getUTCDate() + offset,
        hour,
        minute,
        0,
        0
      )
    );
    if (!matchesDay(candidateEat)) continue;
    const utcMs = candidateEat.getTime() - EAT_OFFSET_MS;
    if (utcMs > nowMs) return utcMs;
  }
  return nowMs + 24 * 60 * 60 * 1000;
};

const DAY_MATCHERS: Record<SnapshotPeriod, (eatDay: Date) => boolean> = {
  daily: () => true,
  weekly: (eatDay) => eatDay.getUTCDay() === 1, // Monday saves the finished Mon–Sun week
  monthly: (eatDay) => eatDay.getUTCDate() === 1,
};

// Node setTimeout delays are 32-bit signed ints (max ~24.8 days). Monthly can be ~31
// days away; a larger delay is clamped to 1ms and the job would spin. Sleep in 1-day
// chunks and only run the snapshot once the real target is due.
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const scheduleTimes = (): Record<SnapshotPeriod, { hour: number; minute: number }> => ({
  daily: parseHhMm(config.leaderboardDailySnapshotTimeEat, 0, 5),
  weekly: parseHhMm(config.leaderboardWeeklySnapshotTimeEat, 0, 10),
  monthly: parseHhMm(config.leaderboardMonthlySnapshotTimeEat, 0, 15),
});

const describe = (result: SnapshotResult): string =>
  result.ok
    ? `${result.period} ${result.periodStart}: ${result.updated ? `saved ${result.rowsSaved} row(s)` : 'already up to date'}`
    : `${result.period}: FAILED (${result.error})`;

export const startLeaderboardSnapshotRuntime = (): LeaderboardSnapshotRuntime => {
  const times = scheduleTimes();
  const timers: NodeJS.Timeout[] = [];

  const schedule = (period: SnapshotPeriod) => {
    const { hour, minute } = times[period];
    const targetMs = nextEatRunMs(Date.now(), hour, minute, DAY_MATCHERS[period]);
    const remainingMs = Math.max(targetMs - Date.now(), 0);
    const waitMs = Math.min(remainingMs, MAX_TIMEOUT_MS);
    process.stdout.write(
      `[leaderboardSnapshot] Next ${period} snapshot in ${Math.round(remainingMs / 60000)}min ` +
        `(${new Date(targetMs).toISOString()})` +
        (waitMs < remainingMs ? `; waking in ${Math.round(waitMs / 60000)}min` : '') +
        `\n`
    );

    const timer = setTimeout(() => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);

      if (Date.now() < targetMs) {
        schedule(period);
        return;
      }

      void syncOneSnapshot(period)
        .then((result) => {
          process.stdout.write(`[leaderboardSnapshot] ${describe(result)}\n`);
        })
        .catch((error) => {
          process.stderr.write(`[leaderboardSnapshot] ${period} run threw: ${String(error)}\n`);
        })
        .finally(() => {
          schedule(period);
        });
    }, waitMs);

    timers.push(timer);
  };

  // Restart recovery: repair only the latest completed day, week and month (plan §13).
  void syncAllSnapshots()
    .then((results) => {
      for (const result of results) {
        process.stdout.write(`[leaderboardSnapshot] startup check — ${describe(result)}\n`);
      }
    })
    .catch((error) => {
      process.stderr.write(`[leaderboardSnapshot] startup check failed: ${String(error)}\n`);
    });

  for (const period of Object.keys(DAY_MATCHERS) as SnapshotPeriod[]) {
    schedule(period);
  }

  return { timers };
};

export const stopLeaderboardSnapshotRuntime = (runtime: LeaderboardSnapshotRuntime): void => {
  for (const timer of runtime.timers) clearTimeout(timer);
  runtime.timers.length = 0;
};

// Exported for tests / diagnostics.
export const __internals = { nextEatRunMs, parseHhMm, DAY_MATCHERS, MAX_TIMEOUT_MS };
