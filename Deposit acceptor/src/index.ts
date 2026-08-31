import dotenv from 'dotenv';
import type { Server } from 'http';
import { loadEnv } from './env';
import { createLogger } from './logger';
import { createDatabase } from './db';
import { createRegexCache } from './regexCache';
import { createMetrics } from './metrics';
import { SlidingWindowLimiter, MinIntervalGate } from './rateLimit';
import { createApp } from './app';
import { createKeyLock } from './keyLock';

async function main() {
  dotenv.config();
  const env = loadEnv();
  const logger = createLogger(env);
  const db = createDatabase(env);
  const metrics = createMetrics();
  const regexCache = createRegexCache();
  const keyLock = createKeyLock();
  const runtimeStatus = {
    httpListening: false,
    regexReady: false,
  };
  let shuttingDown = false;
  let activeServer: Server | null = null;

  const wait = async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  const loadRegexWithRetry = async () => {
    while (!shuttingDown) {
      try {
        const n = await regexCache.reloadAll(db);
        runtimeStatus.regexReady = true;
        logger.info({ reloaded: n }, 'regex cache loaded on startup');
        return;
      } catch (e) {
        runtimeStatus.regexReady = false;
        logger.error({ err: String(e) }, 'failed to load regex cache, retrying');
        await wait(5_000);
      }
    }
  };

  const smsLimiter = new SlidingWindowLimiter(env.RATE_LIMIT_SMS, 60_000);
  const wakeupLimiter = new SlidingWindowLimiter(env.RATE_LIMIT_WAKEUP, 60_000);
  const wakeupGate = new MinIntervalGate(env.MIN_RELOAD_INTERVAL_MS);

  const app = createApp({
    env,
    db,
    metrics,
    regexCache,
    logger,
    smsLimiter,
    wakeupLimiter,
    wakeupGate,
    keyLock,
    getRuntimeStatus: () => ({ ...runtimeStatus }),
  });
  const port = env.PORT;

  const bindOnce = async (): Promise<Server> => {
    return await new Promise((resolve, reject) => {
      const server = app.listen(port);
      server.once('listening', () => {
        runtimeStatus.httpListening = true;
        logger.info({ port }, 'deposit_acceptor service listening');
        resolve(server);
      });
      server.once('error', (err) => {
        runtimeStatus.httpListening = false;
        reject(err);
      });
    });
  };

  const runServerLoop = async () => {
    while (!shuttingDown) {
      try {
        const server = await bindOnce();
        activeServer = server;
        await new Promise<void>((resolve) => {
          server.on('error', (err) => {
            runtimeStatus.httpListening = false;
            logger.error({ err: String(err) }, 'http server error, rebinding');
            server.close(() => resolve());
          });
          server.on('close', () => {
            runtimeStatus.httpListening = false;
            activeServer = null;
            resolve();
          });
        });
      } catch (e) {
        runtimeStatus.httpListening = false;
        logger.error({ err: String(e) }, 'http bind failed, retrying');
      }
      if (!shuttingDown) {
        await wait(env.HTTP_REBIND_DELAY_MS);
      }
    }
  };

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const server = activeServer;
    activeServer = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await db.close();
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  void runServerLoop();
  void loadRegexWithRetry();
}

main().catch((e) => {
  console.error(e);
});
