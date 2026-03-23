import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { config } from './config';
import adminRoutes from './routes/adminRoutes';
import authRoutes from './routes/authRoutes';

const app = express();

// ── Security headers ──
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.disable('x-powered-by');
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

type RuntimeHealth = {
  mode: 'healthy' | 'degraded';
  degradedSince: string | null;
  reason: string | null;
  restartAttempts: number;
  updatedAt: string;
};

const runtimeHealth: RuntimeHealth = {
  mode: 'healthy',
  degradedSince: null,
  reason: null,
  restartAttempts: 0,
  updatedAt: new Date().toISOString(),
};

export const markRuntimeHealthy = () => {
  runtimeHealth.mode = 'healthy';
  runtimeHealth.degradedSince = null;
  runtimeHealth.reason = null;
  runtimeHealth.restartAttempts = 0;
  runtimeHealth.updatedAt = new Date().toISOString();
};

export const markRuntimeDegraded = (reason: string, restartAttempts: number) => {
  if (!runtimeHealth.degradedSince) {
    runtimeHealth.degradedSince = new Date().toISOString();
  }
  runtimeHealth.mode = 'degraded';
  runtimeHealth.reason = reason;
  runtimeHealth.restartAttempts = restartAttempts;
  runtimeHealth.updatedAt = new Date().toISOString();
};

app.get('/health', (_req, res) => {
  const isHealthy = runtimeHealth.mode === 'healthy';
  const payload = {
    status: isHealthy ? 'ok' : 'degraded',
    mode: runtimeHealth.mode,
    degradedSince: runtimeHealth.degradedSince,
    reason: runtimeHealth.reason,
    restartAttempts: runtimeHealth.restartAttempts,
    updatedAt: runtimeHealth.updatedAt,
  };
  if (isHealthy) {
    res.json(payload);
    return;
  }
  res.status(503).json(payload);
});

app.use(
  '/admin',
  cors({
    origin: config.adminClientOrigin,
    credentials: true,
  }),
  express.json({ limit: '1mb' }),
  cookieParser()
);
app.use('/admin', authRoutes);
app.use('/admin', adminRoutes);

// ── Global error handler ──
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ErrorHandler]', err.message);
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' });
});

export default app;
