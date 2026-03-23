import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export type AdminRole = 'super_admin' | 'withdrawal_admin';
type AdminPayload = { adminId: number; role: AdminRole };

export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const token =
    (req.cookies?.admin_access_token as string | undefined) ??
    req.header('authorization')?.replace('Bearer ', '');

  if (!token || !config.jwtSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as AdminPayload;
    (req as Request & { admin?: { adminId: number; role: string } }).admin = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
};

export const requireAdminRole = (allowedRoles: AdminRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const admin = (req as Request & { admin?: AdminPayload }).admin;
    if (!admin) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!allowedRoles.includes(admin.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return next();
  };
};
