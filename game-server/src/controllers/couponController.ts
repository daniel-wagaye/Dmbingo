import { Request, Response } from 'express';
import { config } from '../config';
import { isAllowed } from '../middlewares/rateLimitPerUser';
import { sql } from '../db/drizzle';

const ERROR_MAP: Record<string, { status: number; message: string }> = {
  INVALID_COUPON:        { status: 400, message: 'Invalid coupon' },
  COUPON_EXPIRED:        { status: 400, message: 'Coupon has expired' },
  COUPON_FULLY_REDEEMED: { status: 400, message: 'This coupon has been fully redeemed' },
  COUPON_NOT_STARTED:    { status: 400, message: 'Coupon not yet valid' },
  ALREADY_REDEEMED:      { status: 400, message: 'You have already redeemed this coupon' },
  USER_NOT_FOUND:        { status: 400, message: 'User does not exist' },
  INTERNAL_ERROR:        { status: 500, message: 'Something went wrong. Try again.' },
};

export async function redeemCoupon(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;

    if (!isAllowed('coupon', telegramId, config.couponRateLimitWindowMs, config.couponRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many attempts. Try again later.' });
      return;
    }

    const couponCode = req.body?.coupon_code;
    if (!couponCode || typeof couponCode !== 'string') {
      res.status(400).json({ error: 'MISSING_COUPON_CODE', message: 'Coupon code is required' });
      return;
    }

    const trimmed = couponCode.trim();
    if (trimmed.length === 0 || trimmed.length > 10) {
      res.status(400).json({ error: 'INVALID_COUPON_CODE', message: 'Coupon code must be 1–10 characters' });
      return;
    }

    const rows = await sql`SELECT redeem_coupon(${trimmed}, ${telegramId}::bigint) AS result`;
    const dbResult = rows[0]?.result;

    if (!dbResult) {
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    if (dbResult.success) {
      const message = `Congratulations! You've received ${dbResult.credited_amount} ETB to your ${dbResult.credit_wallet} wallet from coupon ${dbResult.coupon_code}`;
      res.status(200).json({
        success: true,
        coupon_prize: dbResult.coupon_prize,
        credited_amount: dbResult.credited_amount,
        credit_wallet: dbResult.credit_wallet,
        coupon_code: dbResult.coupon_code,
        message,
      });
    } else {
      const mapped = ERROR_MAP[dbResult.code] || { status: 500, message: 'Unknown error' };
      res.status(mapped.status).json({ error: mapped.message });
    }
  } catch (err) {
    console.error('[redeemCoupon]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}