import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[ErrorHandler]', err.message, err.stack);
  res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong.' });
}