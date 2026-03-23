import { createServer, type Server } from 'node:http';
import app, { markRuntimeDegraded, markRuntimeHealthy } from './app';
import { config } from './config';
import { pool } from './db/drizzle';
import { registerSupportRoutes, startSupportRuntime, stopSupportRuntime } from './support';
import { isStartCommandEnabled } from './services/startCommandService';

const bootstrap = async (): Promise<void> => {
  // Load start command status into memory cache on boot
  await isStartCommandEnabled();

  const supportRuntime = await startSupportRuntime();
  registerSupportRoutes(app, supportRuntime.worker);

  let activeServer: Server | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let restartAttempts = 0;
  let isShuttingDown = false;
  const baseDelayMs = 500;
  const maxDelayMs = 15000;

  const clearRestartTimer = () => {
    if (!restartTimer) {
      return;
    }
    clearTimeout(restartTimer);
    restartTimer = null;
  };

  const scheduleRebind = (reason: string) => {
    if (isShuttingDown || restartTimer) {
      return;
    }
    restartAttempts += 1;
    const delayMs = Math.min(baseDelayMs * 2 ** Math.max(restartAttempts - 1, 0), maxDelayMs);
    markRuntimeDegraded(reason, restartAttempts);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void bindServer();
    }, delayMs);
  };

  const bindServer = async () => {
    if (isShuttingDown) {
      return;
    }
    const server = createServer(app);
    const onUnexpectedClose = () => {
      if (isShuttingDown) {
        return;
      }
      if (activeServer === server) {
        activeServer = null;
      }
      scheduleRebind('listener_closed_unexpectedly');
    };
    const onListenerError = (error: Error) => {
      process.stderr.write(`listener error: ${error.message}\n`);
      if (activeServer === server) {
        activeServer = null;
      }
      scheduleRebind(`listener_error:${error.name}`);
      try {
        server.close();
      } catch {
        scheduleRebind(`listener_close_failed:${error.name}`);
      }
    };
    server.on('close', onUnexpectedClose);
    server.on('error', onListenerError);

    try {
      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          server.off('error', onStartupError);
          resolve();
        };
        const onStartupError = (error: Error) => {
          server.off('listening', onReady);
          reject(error);
        };
        server.once('listening', onReady);
        server.once('error', onStartupError);
        server.listen(config.port);
      });
      activeServer = server;
      restartAttempts = 0;
      clearRestartTimer();
      markRuntimeHealthy();
      console.log(`Admin server listening on port ${config.port}`);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
      process.stderr.write(`bind failed: ${message}\n`);
      scheduleRebind(`bind_failed:${message}`);
      try {
        server.close();
      } catch {
        scheduleRebind(`bind_cleanup_failed:${message}`);
      }
    }
  };

  await bindServer();

  const shutdown = async (signal: string): Promise<void> => {
    isShuttingDown = true;
    clearRestartTimer();
    markRuntimeDegraded(`shutdown:${signal}`, restartAttempts);
    await stopSupportRuntime(supportRuntime, signal);
    if (activeServer) {
      const serverToClose = activeServer;
      activeServer = null;
      await new Promise<void>((resolve, reject) => {
        serverToClose.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
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
};

// Global safety nets — prevent unhandled errors from crashing the process
process.on('uncaughtException', (err) => {
  process.stderr.write(`[FATAL] Uncaught exception (process kept alive): ${err.message}\n${err.stack}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[FATAL] Unhandled rejection (process kept alive): ${String(reason)}\n`);
});

void bootstrap().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
