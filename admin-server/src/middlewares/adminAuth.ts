import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const token =
    (req.cookies?.admin_access_token as string | undefined) ??
    req.header('authorization')?.replace('Bearer ', '');

  if (!token || !config.jwtSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      adminId: number;
      role: 'super_admin' | 'withdrawal_admin';
    };
    (req as Request & { admin?: { adminId: number; role: string } }).admin = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
};
