import { Router } from 'express';
import { webhookAuth } from '../middlewares/webhookAuth';
import type { WithdrawalWorker } from '../services/withdrawalWorker';

interface WakeBody {
  event?: string;
}

export const createWebhookRoutes = (worker: WithdrawalWorker): Router => {
  const router = Router();

  router.post('/withdraw-created', webhookAuth, (req, res) => {
    const body = req.body as WakeBody;
    if (body.event !== 'new') {
      res.status(400).json({ error: 'Invalid event value' });
      return;
    }
    worker.wakeCreated();
    res.status(202).json({ accepted: true });
  });

  router.post('/withdraw-updated', webhookAuth, (req, res) => {
    const body = req.body as WakeBody;
    if (body.event !== 'updated') {
      res.status(400).json({ error: 'Invalid event value' });
      return;
    }
    worker.wakeUpdated();
    res.status(202).json({ accepted: true });
  });

  return router;
};
