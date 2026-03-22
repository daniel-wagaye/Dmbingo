import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { config } from './config';
import adminRoutes from './routes/adminRoutes';
import authRoutes from './routes/authRoutes';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
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

export default app;
