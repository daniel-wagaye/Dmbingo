import { Request, Response } from 'express';
import { config } from '../config';
import { isAllowed } from '../middlewares/rateLimitPerUser';
import { userSql as sql } from '../db/drizzle';
import { encodeCursor, decodeCursor } from '../utils/encoding';

const VALID_FILTERS = ['all', 'win', 'withdraw', 'transfer', 'coupon'];
const MAX_LIMIT = 100;

export async function getHistory(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;

    if (!isAllowed('history', telegramId, config.historyRateLimitWindowMs, config.historyRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please slow down.' });
      return;
    }

    const filter = req.body?.filter || 'all';
    if (!VALID_FILTERS.includes(filter)) {
      res.status(400).json({ error: 'INVALID_FILTER' });
      return;
    }

    let limit = parseInt(req.body?.limit, 10) || MAX_LIMIT;
    if (limit > MAX_LIMIT || limit < 1) limit = MAX_LIMIT;

    const rawCursor = req.body?.cursor || null;
    let cursorData: { created_at: string; id: string } | null = null;
    if (rawCursor) {
      cursorData = decodeCursor(rawCursor);
      if (!cursorData) {
        res.status(400).json({ error: 'INVALID_CURSOR' });
        return;
      }
    }

    // Build union queries per filter
    const parts: string[] = [];

    if (filter === 'all' || filter === 'withdraw') {
      parts.push(`
        SELECT
          'withdraw' AS type,
          'Withdrawal' AS title,
          w.amount::text AS amount,
          'ETB' AS currency,
          w.bank,
          w.account_num,
          w.account_holder_name,
          w.status,
          NULL AS wallet,
          NULL AS direction,
          NULL AS commission,
          NULL AS credit_wallet,
          w.created_at,
          w.withdrawal_id::text AS row_id
        FROM withdrawals_request w
        WHERE w.telegram_id = ${telegramId}
      `);
    }

    if (filter === 'all' || filter === 'win') {
      parts.push(`
        SELECT
          'win' AS type,
          'Win' AS title,
          wh.credited_amount::text AS amount,
          'ETB' AS currency,
          NULL AS bank,
          NULL AS account_num,
          NULL AS account_holder_name,
          NULL AS status,
          NULL AS wallet,
          NULL AS direction,
          NULL AS commission,
          NULL AS credit_wallet,
          wh.won_at AS created_at,
          wh.id::text AS row_id
        FROM winners_history wh
        WHERE wh.telegram_id = ${telegramId}
      `);
    }

    if (filter === 'all' || filter === 'transfer') {
      // Sent transfers
      parts.push(`
        SELECT
          'transfer' AS type,
          'Transfer Sent' AS title,
          ('-' || t.amount)::text AS amount,
          'ETB' AS currency,
          NULL AS bank,
          NULL AS account_num,
          NULL AS account_holder_name,
          NULL AS status,
          t.wallet,
          'sent' AS direction,
          t.commission::text AS commission,
          NULL AS credit_wallet,
          t.created_at,
          ('s' || t.transfer_id)::text AS row_id
        FROM transfer_history t
        WHERE t.sender_id = ${telegramId}
      `);
      // Received transfers
      parts.push(`
        SELECT
          'transfer' AS type,
          'Transfer Received' AS title,
          t.amount::text AS amount,
          'ETB' AS currency,
          NULL AS bank,
          NULL AS account_num,
          NULL AS account_holder_name,
          NULL AS status,
          t.wallet,
          'received' AS direction,
          '0' AS commission,
          NULL AS credit_wallet,
          t.created_at,
          ('r' || t.transfer_id)::text AS row_id
        FROM transfer_history t
        WHERE t.receiver_id = ${telegramId}
      `);
    }

    if (filter === 'all' || filter === 'coupon') {
      parts.push(`
        SELECT
          'coupon' AS type,
          'Coupon' AS title,
          ch.credited_amount::text AS amount,
          'ETB' AS currency,
          NULL AS bank,
          NULL AS account_num,
          NULL AS account_holder_name,
          NULL AS status,
          NULL AS wallet,
          NULL AS direction,
          NULL AS commission,
          ch.credit_wallet,
          ch.claimed_at AS created_at,
          ch.claimed_id::text AS row_id
        FROM coupon_history ch
        WHERE ch.user_telegram_id = ${telegramId}
      `);
    }

    if (parts.length === 0) {
      res.status(200).json({ success: true, rows: [], next_cursor: null });
      return;
    }

    const unionQuery = parts.join(' UNION ALL ');

    let cursorCondition = '';
    if (cursorData) {
      cursorCondition = `WHERE (sub.created_at, sub.row_id) < ('${cursorData.created_at}'::timestamptz, '${cursorData.id}')`;
    }

    const fullQuery = `
      SELECT * FROM (${unionQuery}) sub
      ${cursorCondition}
      ORDER BY sub.created_at DESC, sub.row_id DESC
      LIMIT ${limit}
    `;

    const rows = await sql.unsafe(fullQuery);

    // Build next_cursor from last row
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor(
        new Date(last.created_at).toISOString(),
        last.row_id
      );
    }

    // Strip row_id from response (frontend must not see DB ids)
    const cleanRows = rows.map((r: any) => {
      const { row_id, ...rest } = r;
      return rest;
    });

    res.status(200).json({ success: true, rows: cleanRows, next_cursor: nextCursor });
  } catch (err) {
    console.error('[getHistory]', err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}