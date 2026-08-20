import { Request, Response } from 'express';
import { config } from '../config';
import { isAllowed } from '../middlewares/rateLimitPerUser';
import { userSql as sql } from '../db/drizzle';
import { BOT_TELEGRAM_IDS } from '../constants/bots';

const VALID_PERIODS = ['daily', 'weekly', 'monthly'] as const;
type Period = typeof VALID_PERIODS[number];

const TOP_N = 10;
// Two complete periods per history page, per the leaderboard plan.
const HISTORY_PERIODS_PER_PAGE = 2;
const TIMEZONE = 'Africa/Addis_Ababa';

// date_trunc('week', ...) starts on Monday, which is the required weekly boundary.
const TRUNC_UNIT: Record<Period, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
};

const PERIOD_LENGTH: Record<Period, string> = {
  daily: '1 day',
  weekly: '1 week',
  monthly: '1 month',
};

const SNAPSHOT_TABLE: Record<Period, string> = {
  daily: 'leaderboard_daily_snapshots',
  weekly: 'leaderboard_weekly_snapshots',
  monthly: 'leaderboard_monthly_snapshots',
};

function maskPhoneLast4(phone: string | null | undefined): string {
  if (!phone) return '****';
  const trimmed = phone.trim();
  if (trimmed.length <= 4) return '****';
  return trimmed.slice(0, -4) + '****';
}

function toNumber(value: string | number | null | undefined): number {
  return typeof value === 'string' ? Number(value) : (value ?? 0);
}

/** Period dates are cast to text in SQL so no driver timezone parsing can shift the day. */
function toDateString(value: string): string {
  return String(value).slice(0, 10);
}

function parsePeriod(raw: unknown): Period | null {
  const period = (raw as Period) || 'daily';
  return VALID_PERIODS.includes(period) ? period : null;
}

// ── POST /api/leaderboard ──
// Current (still-running) period, aggregated live from winners_history.
export async function getLeaderboard(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;

    if (!isAllowed('leaderboard', telegramId, config.leaderboardRateLimitWindowMs, config.leaderboardRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please slow down.' });
      return;
    }

    const period = parsePeriod(req.body?.period);
    if (!period) {
      res.status(400).json({ error: 'INVALID_PERIOD' });
      return;
    }

    // Period boundaries are computed in Africa/Addis_Ababa: date_trunc on the local
    // wall-clock, then AT TIME ZONE converts back to the matching UTC instants.
    // Start is inclusive and end is exclusive so a win at midnight lands in one period only.
    const truncUnit = TRUNC_UNIT[period];
    const periodLength = PERIOD_LENGTH[period];

    const rows = await sql<
      Array<{
        kind: 'top' | 'viewer';
        telegram_id: string | number;
        first_name: string | null;
        phone_number: string | null;
        wins_count: number;
        rank: number | null;
        period_start: string;
        period_end: string;
      }>
    >`
      WITH bounds AS (
        SELECT
          date_trunc(${truncUnit}, (now() AT TIME ZONE ${TIMEZONE})) AS local_start
      ),
      window_bounds AS (
        SELECT
          (b.local_start AT TIME ZONE ${TIMEZONE}) AS start_at,
          ((b.local_start + ${periodLength}::interval) AT TIME ZONE ${TIMEZONE}) AS end_at,
          b.local_start::date::text AS period_start,
          (b.local_start + ${periodLength}::interval)::date::text AS period_end
        FROM bounds b
      ),
      wins AS (
        SELECT wh.telegram_id, COUNT(*)::int AS wins_count
        FROM winners_history wh, window_bounds wb
        WHERE wh.won_at >= wb.start_at
          AND wh.won_at < wb.end_at
          AND wh.telegram_id IS NOT NULL
          AND wh.telegram_id <> ALL(${BOT_TELEGRAM_IDS}::bigint[])
        GROUP BY wh.telegram_id
      ),
      joined AS (
        SELECT w.telegram_id, w.wins_count, u.first_name, u.phone_number
        FROM wins w
        JOIN users u ON u.telegram_id = w.telegram_id
      ),
      ranked AS (
        SELECT
          j.*,
          DENSE_RANK() OVER (ORDER BY j.wins_count DESC)::int AS rank,
          ROW_NUMBER() OVER (
            ORDER BY j.wins_count DESC, LOWER(j.first_name) ASC NULLS LAST, j.telegram_id ASC
          )::int AS ord
        FROM joined j
      ),
      top AS (
        SELECT * FROM ranked WHERE ord <= ${TOP_N}
      )
      SELECT
        'top' AS kind, t.telegram_id, t.first_name, t.phone_number,
        t.wins_count, t.rank, 0 AS grp, t.ord,
        wb.period_start, wb.period_end
      FROM top t, window_bounds wb
      UNION ALL
      SELECT
        'viewer' AS kind, u.telegram_id, u.first_name, u.phone_number,
        COALESCE((SELECT r.wins_count FROM ranked r WHERE r.telegram_id = u.telegram_id), 0) AS wins_count,
        NULL::int AS rank, 1 AS grp, 0 AS ord,
        wb.period_start, wb.period_end
      FROM users u, window_bounds wb
      WHERE u.telegram_id = ${telegramId}
      ORDER BY grp ASC, ord ASC
    `;

    const topRows = rows.filter((r) => r.kind === 'top');
    const viewerRow = rows.find((r) => r.kind === 'viewer');

    const meta = rows[0];
    const periodStart = meta ? toDateString(meta.period_start) : null;
    const periodEnd = meta ? toDateString(meta.period_end) : null;

    const cleanRows = topRows.map((r) => ({
      telegram_id: toNumber(r.telegram_id),
      first_name: r.first_name,
      phone_masked: maskPhoneLast4(r.phone_number),
      wins_count: r.wins_count,
      rank: r.rank,
      is_mine: toNumber(r.telegram_id) === telegramId,
    }));

    // The viewer is only returned separately when they are outside the top 10. Their
    // rank is deliberately not computed there — the client shows "NA" instead.
    const inTop = cleanRows.some((r) => r.is_mine);
    const viewer =
      inTop || !viewerRow
        ? null
        : {
            telegram_id: toNumber(viewerRow.telegram_id),
            first_name: viewerRow.first_name,
            phone_masked: maskPhoneLast4(viewerRow.phone_number),
            wins_count: viewerRow.wins_count,
            rank: null,
            is_mine: true,
          };

    res.status(200).json({
      success: true,
      period,
      period_start: periodStart,
      period_end: periodEnd,
      rows: cleanRows,
      viewer,
    });
  } catch (err) {
    console.error('[getLeaderboard]', err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}

// ── POST /api/leaderboard/history ──
// Completed periods only, read straight from the snapshot tables the admin server writes.
export async function getLeaderboardHistory(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;

    if (!isAllowed('leaderboardHistory', telegramId, config.leaderboardHistoryRateLimitWindowMs, config.leaderboardHistoryRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please slow down.' });
      return;
    }

    const period = parsePeriod(req.body?.period);
    if (!period) {
      res.status(400).json({ error: 'INVALID_PERIOD' });
      return;
    }

    const rawCursor = req.body?.cursor;
    if (rawCursor !== undefined && rawCursor !== null && typeof rawCursor !== 'string') {
      res.status(400).json({ error: 'INVALID_CURSOR' });
      return;
    }
    const cursor = typeof rawCursor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawCursor) ? rawCursor : null;

    const table = SNAPSHOT_TABLE[period];
    const periodLength = PERIOD_LENGTH[period];

    // One extra period is fetched purely to detect whether more history exists.
    const periods = await sql<Array<{ period_start: string }>>`
      SELECT DISTINCT period_start::text AS period_start
      FROM ${sql(table)}
      WHERE ${cursor}::date IS NULL OR period_start < ${cursor}::date
      ORDER BY period_start DESC
      LIMIT ${HISTORY_PERIODS_PER_PAGE + 1}
    `;

    const hasMore = periods.length > HISTORY_PERIODS_PER_PAGE;
    const pagePeriods = periods.slice(0, HISTORY_PERIODS_PER_PAGE).map((p) => toDateString(p.period_start));

    if (pagePeriods.length === 0) {
      res.status(200).json({ success: true, period, groups: [], next_cursor: null, has_more: false });
      return;
    }

    const snapshotRows = await sql<
      Array<{
        period_start: string;
        period_end: string;
        rank: number;
        telegram_id: string | number;
        wins_count: number;
        first_name: string | null;
        phone_number: string | null;
      }>
    >`
      SELECT
        s.period_start::text AS period_start,
        (s.period_start + ${periodLength}::interval)::date::text AS period_end,
        s.rank,
        s.telegram_id,
        s.wins_count,
        u.first_name,
        u.phone_number
      FROM ${sql(table)} s
      LEFT JOIN users u ON u.telegram_id = s.telegram_id
      WHERE s.period_start = ANY(${pagePeriods}::date[])
      ORDER BY s.period_start DESC, s.rank ASC, LOWER(u.first_name) ASC NULLS LAST, s.telegram_id ASC
    `;

    const groups = pagePeriods.map((periodStart) => {
      const groupRows = snapshotRows.filter((r) => toDateString(r.period_start) === periodStart);
      return {
        period_start: periodStart,
        period_end: groupRows.length > 0 ? toDateString(groupRows[0].period_end) : null,
        rows: groupRows.map((r) => ({
          telegram_id: toNumber(r.telegram_id),
          first_name: r.first_name,
          phone_masked: maskPhoneLast4(r.phone_number),
          wins_count: r.wins_count,
          rank: r.rank,
        })),
      };
    });

    res.status(200).json({
      success: true,
      period,
      groups,
      next_cursor: hasMore ? pagePeriods[pagePeriods.length - 1] : null,
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[getLeaderboardHistory]', err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}
