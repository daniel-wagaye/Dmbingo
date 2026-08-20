import { pool } from '../db/drizzle';
import { BOT_TELEGRAM_IDS } from '../constants/bots';

export type SnapshotPeriod = 'daily' | 'weekly' | 'monthly';

export const SNAPSHOT_PERIODS: SnapshotPeriod[] = ['daily', 'weekly', 'monthly'];

const TIMEZONE = 'Africa/Addis_Ababa';
const TOP_N = 10;

// date_trunc('week', ...) starts on Monday, which is the required weekly boundary.
const TRUNC_UNIT: Record<SnapshotPeriod, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
};

const PERIOD_LENGTH: Record<SnapshotPeriod, string> = {
  daily: '1 day',
  weekly: '1 week',
  monthly: '1 month',
};

// Constant identifiers — never built from user input.
const SNAPSHOT_TABLE: Record<SnapshotPeriod, string> = {
  daily: 'leaderboard_daily_snapshots',
  weekly: 'leaderboard_weekly_snapshots',
  monthly: 'leaderboard_monthly_snapshots',
};

export interface SnapshotRow {
  rank: number;
  telegram_id: number;
  wins_count: number;
}

export interface SnapshotResult {
  period: SnapshotPeriod;
  periodStart: string | null;
  rowsSaved: number;
  updated: boolean;
  ok: boolean;
  error?: string;
}

const toDateString = (value: string): string => String(value).slice(0, 10);

const fingerprint = (rows: SnapshotRow[]): string =>
  JSON.stringify(
    [...rows]
      .sort((a, b) => a.telegram_id - b.telegram_id)
      .map((r) => [r.telegram_id, r.rank, r.wins_count])
  );

/**
 * Aggregates the top 10 human players for the most recently completed period.
 *
 * Boundaries are derived on the Africa/Addis_Ababa clock: date_trunc gives the current
 * period's local start, subtracting one period length steps back to the last completed
 * one, and AT TIME ZONE converts both edges back to UTC instants. Start is inclusive and
 * end exclusive so a win at midnight belongs to exactly one period.
 *
 * A win is one winning board. A player who wins a single game on two boards counts twice.
 */
const aggregatePreviousPeriod = async (
  period: SnapshotPeriod
): Promise<{ periodStart: string; rows: SnapshotRow[] }> => {
  const result = await pool.query(
    `
      WITH bounds AS (
        SELECT (date_trunc($1, (now() AT TIME ZONE $2)) - $3::interval) AS local_start
      ),
      window_bounds AS (
        SELECT
          -- Rendered as text in SQL: node-postgres parses DATE into a *local* midnight
          -- Date, which shifts the day on any server that is not on UTC.
          b.local_start::date::text AS period_start,
          (b.local_start AT TIME ZONE $2) AS start_at,
          ((b.local_start + $3::interval) AT TIME ZONE $2) AS end_at
        FROM bounds b
      ),
      wins AS (
        SELECT wh.telegram_id, COUNT(*)::int AS wins_count
        FROM winners_history wh, window_bounds wb
        WHERE wh.won_at >= wb.start_at
          AND wh.won_at < wb.end_at
          AND wh.telegram_id IS NOT NULL
          AND wh.telegram_id <> ALL($4::bigint[])
        GROUP BY wh.telegram_id
      ),
      joined AS (
        SELECT w.telegram_id, w.wins_count, u.first_name
        FROM wins w
        JOIN users u ON u.telegram_id = w.telegram_id
      ),
      ranked AS (
        SELECT
          j.telegram_id,
          j.wins_count,
          DENSE_RANK() OVER (ORDER BY j.wins_count DESC)::int AS rank,
          ROW_NUMBER() OVER (
            ORDER BY j.wins_count DESC, LOWER(j.first_name) ASC NULLS LAST, j.telegram_id ASC
          )::int AS ord
        FROM joined j
      )
      SELECT wb.period_start, r.rank, r.telegram_id, r.wins_count
      FROM window_bounds wb
      LEFT JOIN ranked r ON r.ord <= $5
      ORDER BY r.ord ASC NULLS LAST
    `,
    [TRUNC_UNIT[period], TIMEZONE, PERIOD_LENGTH[period], BOT_TELEGRAM_IDS, TOP_N]
  );

  const periodStart = toDateString(result.rows[0].period_start);
  const rows: SnapshotRow[] = result.rows
    .filter((r) => r.telegram_id !== null)
    .map((r) => ({
      rank: Number(r.rank),
      telegram_id: Number(r.telegram_id),
      wins_count: Number(r.wins_count),
    }));

  return { periodStart, rows };
};

const readStoredSnapshot = async (
  period: SnapshotPeriod,
  periodStart: string
): Promise<SnapshotRow[]> => {
  const result = await pool.query(
    `SELECT rank, telegram_id, wins_count
     FROM ${SNAPSHOT_TABLE[period]}
     WHERE period_start = $1::date`,
    [periodStart]
  );
  return result.rows.map((r) => ({
    rank: Number(r.rank),
    telegram_id: Number(r.telegram_id),
    wins_count: Number(r.wins_count),
  }));
};

/**
 * Replaces the whole period in one transaction so repeating the call is always safe and
 * a period whose top 10 shifted (late finalization) is corrected rather than duplicated.
 */
const writeSnapshot = async (
  period: SnapshotPeriod,
  periodStart: string,
  rows: SnapshotRow[]
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM ${SNAPSHOT_TABLE[period]} WHERE period_start = $1::date`,
      [periodStart]
    );
    if (rows.length > 0) {
      await client.query(
        `INSERT INTO ${SNAPSHOT_TABLE[period]} (period_start, rank, telegram_id, wins_count)
         SELECT $1::date, x.rank, x.telegram_id, x.wins_count
         FROM UNNEST($2::int[], $3::bigint[], $4::int[]) AS x(rank, telegram_id, wins_count)`,
        [
          periodStart,
          rows.map((r) => r.rank),
          rows.map((r) => r.telegram_id),
          rows.map((r) => r.wins_count),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const syncSnapshot = async (period: SnapshotPeriod): Promise<SnapshotResult> => {
  try {
    const { periodStart, rows } = await aggregatePreviousPeriod(period);
    const stored = await readStoredSnapshot(period, periodStart);

    if (fingerprint(stored) === fingerprint(rows)) {
      return { period, periodStart, rowsSaved: stored.length, updated: false, ok: true };
    }

    await writeSnapshot(period, periodStart, rows);
    return { period, periodStart, rowsSaved: rows.length, updated: true, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[leaderboardSnapshot] ${period} sync failed: ${message}\n`);
    return { period, periodStart: null, rowsSaved: 0, updated: false, ok: false, error: message };
  }
};

// Scheduled runs and the admin button share this, so they can never write at the same time.
let queue: Promise<unknown> = Promise.resolve();

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

/** Checks only the latest completed day, week and month — never the whole history. */
export const syncAllSnapshots = async (): Promise<SnapshotResult[]> =>
  enqueue(async () => {
    const results: SnapshotResult[] = [];
    for (const period of SNAPSHOT_PERIODS) {
      results.push(await syncSnapshot(period));
    }
    return results;
  });

export const syncOneSnapshot = async (period: SnapshotPeriod): Promise<SnapshotResult> =>
  enqueue(() => syncSnapshot(period));
