import type { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';
import { sendCouponWinnersIfUnsent } from '../services/couponWinnersService';

const timingSafeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const isAuthorizedWebhook = (req: Request): boolean => {
  const expected = config.webhookPassKey;
  if (!expected) return false;
  const secret =
    req.header('x-webhook-secret') ??
    req.header('X-Webhook-Secret') ??
    req.header('pass-key') ??
    '';
  return Boolean(secret) && timingSafeEquals(secret, expected);
};

const parseCouponId = (body: unknown): number | null => {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const direct = Number(root.coupon_id);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const record =
    root.record && typeof root.record === 'object'
      ? (root.record as Record<string, unknown>)
      : null;
  if (record) {
    const nested = Number(record.coupon_id);
    if (Number.isFinite(nested) && nested > 0) return nested;
  }
  return null;
};

export const couponFinishedWebhook = async (req: Request, res: Response) => {
  if (!isAuthorizedWebhook(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body as { event?: string };
  if (body.event && body.event !== 'COUPON_FINISHED') {
    return res.status(400).json({ error: 'invalid_event' });
  }
  const couponId = parseCouponId(req.body);
  if (!couponId) {
    return res.status(400).json({ error: 'invalid_coupon_id' });
  }

  try {
    const result = await sendCouponWinnersIfUnsent(couponId);
    return res.json({ status: 'ok', ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send_failed';
    if (message === 'coupon_not_found') {
      return res.status(404).json({ error: message });
    }
    if (message === 'coupon_not_finished') {
      return res.json({ status: 'ok', sent: false, skipped: true, reason: message });
    }
    console.error('[coupon-finished webhook]', error);
    return res.status(500).json({ error: 'send_failed', message });
  }
};
