import { pool } from '../db/drizzle';
import { COUPON_WINNERS_CAPTION, sendGroupDocument } from './telegramNotifier';

const toCsvValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const buildWinnersCsv = (
  rows: Array<{
    claimed_id: unknown;
    coupon_code: unknown;
    coupon_id: unknown;
    user_telegram_id: unknown;
    claimed_at: unknown;
    coupon_prize: unknown;
    credited_amount: unknown;
    credit_wallet: unknown;
  }>
) => {
  const header = [
    'Claimed ID',
    'Coupon Code',
    'Coupon ID',
    'User Telegram ID',
    'Claimed At',
    'Coupon Prize',
    'Credited Amount',
    'Credit Wallet',
  ];
  return [
    header.map(toCsvValue).join(','),
    ...rows.map((row) =>
      [
        row.claimed_id,
        row.coupon_code,
        row.coupon_id,
        row.user_telegram_id,
        row.claimed_at,
        row.coupon_prize,
        row.credited_amount,
        row.credit_wallet,
      ]
        .map(toCsvValue)
        .join(',')
    ),
  ].join('\n');
};

export const sendCouponWinnersIfUnsent = async (
  couponId: number
): Promise<{ sent: boolean; skipped: boolean }> => {
  const existing = await pool.query(
    `SELECT coupon_id, coupon_code, status, sent FROM coupons WHERE coupon_id = $1`,
    [couponId]
  );
  if (!existing.rows.length) {
    const error = new Error('coupon_not_found');
    throw error;
  }
  const row = existing.rows[0] as {
    coupon_code: string;
    status: string;
    sent: boolean;
  };
  if (row.sent === true) {
    return { sent: false, skipped: true };
  }
  if (row.status !== 'finished') {
    const error = new Error('coupon_not_finished');
    throw error;
  }

  const claimed = await pool.query(
    `UPDATE coupons
     SET sent = TRUE
     WHERE coupon_id = $1 AND status = 'finished' AND sent = FALSE
     RETURNING coupon_id, coupon_code`,
    [couponId]
  );
  if (!claimed.rows.length) {
    return { sent: false, skipped: true };
  }

  try {
    const history = await pool.query(
      `
        SELECT
          h.claimed_id,
          c.coupon_code,
          h.coupon_id,
          h.user_telegram_id,
          h.claimed_at,
          h.credited_amount,
          h.credit_wallet,
          c.coupon_prize
        FROM coupon_history h
        LEFT JOIN coupons c ON c.coupon_id = h.coupon_id
        WHERE h.coupon_id = $1
        ORDER BY h.claimed_at ASC
      `,
      [couponId]
    );
    const csv = buildWinnersCsv(history.rows);
    await sendGroupDocument({
      filename: `coupon-${couponId}-winners.csv`,
      bytes: Buffer.from(csv, 'utf8'),
      caption: COUPON_WINNERS_CAPTION,
    });
    return { sent: true, skipped: false };
  } catch (error) {
    await pool.query(
      `UPDATE coupons
       SET sent = FALSE
       WHERE coupon_id = $1 AND status = 'finished' AND sent = TRUE`,
      [couponId]
    );
    throw error;
  }
};
