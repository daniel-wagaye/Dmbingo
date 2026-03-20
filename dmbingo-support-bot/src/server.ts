import { createApp } from './app';
import { SupportLookupBot } from './bot/supportLookupBot';
import { config } from './config/env';
import { LookupRepository } from './db/lookupRepository';
import { pool } from './db/pool';
import { WithdrawalWorker } from './services/withdrawalWorker';

const worker = new WithdrawalWorker(pool);
const app = createApp(worker);
const lookupRepository = new LookupRepository(pool);
const bot = new SupportLookupBot(lookupRepository);

const server = app.listen(config.port, () => {
  process.stdout.write(`dmbingo-support-bot listening on ${config.port}\n`);
});

const recoveryTimer = setInterval(() => {
  void worker.runRecovery();
}, config.recoveryJobIntervalMs);

void bot.launch();

const shutdown = async (signal: string): Promise<void> => {
  clearInterval(recoveryTimer);
  await bot.stop(signal);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await pool.end();
};

process.on('SIGINT', () => {
  void shutdown('SIGINT').catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM').catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
});
