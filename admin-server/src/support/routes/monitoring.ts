import { Router } from 'express';
import crypto from 'crypto';
import { config } from '../../config';
import type { WithdrawalWorker } from '../services/withdrawalWorker';

const isAuthorized = (authorizationHeader?: string): boolean => {
  if (!config.monitoringBearerToken) {
    return false;
  }
  if (!authorizationHeader) {
    return false;
  }
  const value = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  const left = Buffer.from(value);
  const right = Buffer.from(config.monitoringBearerToken);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
};

export const createMonitoringRoutes = (worker: WithdrawalWorker): Router => {
  const router = Router();

  router.get('/failed-withdrawals', async (req, res) => {
    if (!isAuthorized(req.header('authorization'))) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const failedRows = await worker.getFailedRows(100);
    res.json({
      count: failedRows.length,
      rows: failedRows.map((row) => ({
        withdrawal_id: row.withdrawal_id,
        telegram_id: row.telegram_id,
        status: row.status,
        text_status: row.text_status,
        attempts: row.attempts,
        last_error: row.last_error,
        created_at: row.created_at,
        processed_at: row.processed_at,
      })),
    });
  });

  return router;
};
