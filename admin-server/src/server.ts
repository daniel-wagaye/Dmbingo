import app from './app';
import { config } from './config';
import { pool } from './db/drizzle';
import { registerSupportRoutes, startSupportRuntime, stopSupportRuntime } from './support';

const bootstrap = async (): Promise<void> => {
  const supportRuntime = await startSupportRuntime(pool);
  registerSupportRoutes(app, supportRuntime.worker);

  const server = app.listen(config.port, () => {
    console.log(`Admin server listening on port ${config.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    await stopSupportRuntime(supportRuntime, signal);
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
};

void bootstrap().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
