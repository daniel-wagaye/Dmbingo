import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/env';

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

const getClientKey = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
};

export const globalRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const now = Date.now();
  const key = getClientKey(req);
  const existing = buckets.get(key);

  if (!existing || now > existing.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + config.globalRateLimitWindowMs,
    });
    next();
    return;
  }

  if (existing.count >= config.globalRateLimitMaxRequests) {
    const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
    res.status(429).json({ error: 'Too many requests' });
    return;
  }

  existing.count += 1;
  buckets.set(key, existing);
  next();
};
