import { Request, Response, NextFunction } from 'express';
import { verifyTelegramInitData, ParsedInitData } from '../utils/hmac';
import { config } from '../config';

declare global {
  namespace Express {
    interface Request {
      telegramUser?: ParsedInitData;
    }
  }
}

export function verifyInitData(req: Request, res: Response, next: NextFunction): void {
  const initData = req.header('X-Telegram-Init-Data');
  if (!initData) {
    res.status(401).json({ error: 'AUTH_FAILED', message: 'Missing initData header' });
    return;
  }

  const parsed = verifyTelegramInitData(initData, config.botToken);
  if (!parsed) {
    res.status(401).json({ error: 'AUTH_FAILED', message: 'Invalid authentication data' });
    return;
  }

  req.telegramUser = parsed;
  next();
}