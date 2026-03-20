import { timingSafeEqual } from 'crypto';
import type { NextFunction, Response } from 'express';
import { config } from '../config/env';
import type { RawBodyRequest } from '../types';

const timingSafeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const webhookAuth = (req: RawBodyRequest, res: Response, next: NextFunction): void => {
  const passKey = req.header('pass-key');
  if (passKey && timingSafeEquals(passKey, config.webhookPassKey)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
};
