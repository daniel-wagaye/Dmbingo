import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../../config';

const timingSafeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const webhookAuth = (req: Request, res: Response, next: NextFunction): void => {
  const passKey = req.header('pass-key');
  if (passKey && timingSafeEquals(passKey, config.webhookPassKey)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
};
