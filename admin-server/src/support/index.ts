import type { Express } from 'express';
import express from 'express';
import { config } from '../config';
import { pool } from '../db/drizzle';
import { SupportLookupBot } from './bot/supportLookupBot';
import { LookupRepository } from './db/lookupRepository';
import { globalRateLimit } from './middlewares/globalRateLimit';
import { createMonitoringRoutes } from './routes/monitoring';
import { createWebhookRoutes } from './routes/webhooks';
import { WithdrawalWorker } from './services/withdrawalWorker';

export interface SupportRuntime {
  worker: WithdrawalWorker;
  bot: SupportLookupBot | null;
  recoveryTimer: NodeJS.Timeout;
}

let activeWorker: WithdrawalWorker | null = null;

export const triggerWithdrawalUpdatedSync = (): void => {
  if (!activeWorker) {
    return;
  }
  try {
    activeWorker.wakeUpdated();
  } catch (error) {
    process.stderr.write(`Support update wake failed: ${String(error)}\n`);
  }
};

export const registerSupportRoutes = (app: Express, worker: WithdrawalWorker): void => {
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  const supportRouter = express.Router();
  supportRouter.use(
    express.json({
      limit: config.webhookBodyLimit,
    })
  );
  supportRouter.use(globalRateLimit);
  supportRouter.use('/webhook', createWebhookRoutes(worker));
  supportRouter.use('/monitoring', createMonitoringRoutes(worker));
  app.use(supportRouter);
};

export const startSupportRuntime = async (): Promise<SupportRuntime> => {
  const worker = new WithdrawalWorker(pool);
  activeWorker = worker;
  const lookupRepository = new LookupRepository(pool);
  const bot = config.supportBotToken ? new SupportLookupBot(lookupRepository) : null;
  if (bot) {
    void bot.launch().then(
      () => {
        process.stdout.write('Support lookup bot started\n');
      },
      (error) => {
        process.stderr.write(`Support lookup bot failed to start: ${String(error)}\n`);
      }
    );
  }
  const recoveryTimer = setInterval(() => {
    void worker.runRecovery();
  }, config.recoveryJobIntervalMs);
  return { worker, bot, recoveryTimer };
};

export const stopSupportRuntime = async (runtime: SupportRuntime, signal: string): Promise<void> => {
  if (activeWorker === runtime.worker) {
    activeWorker = null;
  }
  clearInterval(runtime.recoveryTimer);
  if (runtime.bot) {
    await runtime.bot.stop(signal);
  }
};
