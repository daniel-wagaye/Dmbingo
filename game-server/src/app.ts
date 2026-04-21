import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler } from './middlewares/errorHandler';
import { getHealth } from './utils/health';
import userRoutes from './routes/api/userRoutes';
import gameRoutes from './routes/api/gameRoutes';
import historyRoutes from './routes/api/historyRoutes';
import couponRoutes from './routes/api/couponRoutes';
import depositRoutes from './routes/api/depositRoutes';
import withdrawRoutes from './routes/api/withdrawRoutes';
import transferRoutes from './routes/api/transferRoutes';
import internalRoutes from './routes/internalRoutes';

const app = express();

// ── Security headers ──
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// ── Trust proxy (Cloudflare tunnel / Render) ──
app.set('trust proxy', 1);

// ── CORS ──
app.use(cors({
  origin: config.clientUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data', 'X-Telegram-Contact-Raw', 'X-Game-Secret'],
}));

// ── Body parsing with size limit ──
app.use(express.json({ limit: '64kb' }));

// ── Disable X-Powered-By ──
app.disable('x-powered-by');

// ── Health (no auth) ──
app.get('/health', (_req, res) => {
  const h = getHealth();
  const code = h.status === 'healthy' ? 200 : 503;
  res.status(code).json(h);
});

// ── API routes ──
app.use('/api', userRoutes);
app.use('/api', gameRoutes);
app.use('/api', historyRoutes);
app.use('/api', couponRoutes);
app.use('/api', depositRoutes);
app.use('/api', withdrawRoutes);
app.use('/api', transferRoutes);
app.use(internalRoutes);

// ── Global error handler ──
app.use(errorHandler);

export default app;