import express from 'express';
import { config } from './config/env';
import { globalRateLimit } from './middlewares/globalRateLimit';
import { createMonitoringRoutes } from './routes/monitoring';
import { createWebhookRoutes } from './routes/webhooks';
import type { WithdrawalWorker } from './services/withdrawalWorker';
import type { RawBodyRequest } from './types';

export const createApp = (worker: WithdrawalWorker): express.Express => {
  const app = express();

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(
    express.json({
      limit: config.webhookBodyLimit,
      verify: (req, _res, buffer) => {
        (req as RawBodyRequest).rawBody = Buffer.from(buffer);
      },
    }),
  );

  app.use(globalRateLimit);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/webhook', createWebhookRoutes(worker));
  app.use('/monitoring', createMonitoringRoutes(worker));

  app.use((error: unknown, _req: express.Request, res: express.Response) => {
    res.status(500).json({
      error: 'Internal server error',
      details: config.nodeEnv === 'production' ? undefined : String(error),
    });
  });

  return app;
};
