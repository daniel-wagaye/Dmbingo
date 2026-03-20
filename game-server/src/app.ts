import express from 'express';
import cors from 'cors';
import { config } from './config';
import { errorHandler } from './middlewares/errorHandler';
import userRoutes from './routes/api/userRoutes';
import gameRoutes from './routes/api/gameRoutes';
import historyRoutes from './routes/api/historyRoutes';
import couponRoutes from './routes/api/couponRoutes';
import depositRoutes from './routes/api/depositRoutes';
import withdrawRoutes from './routes/api/withdrawRoutes';
import transferRoutes from './routes/api/transferRoutes';
import internalRoutes from './routes/internalRoutes';

const app = express();

app.use(cors({
  origin: config.clientUrl,
  credentials: true,
}));
app.use(express.json());

app.use('/api', userRoutes);
app.use('/api', gameRoutes);
app.use('/api', historyRoutes);
app.use('/api', couponRoutes);
app.use('/api', depositRoutes);
app.use('/api', withdrawRoutes);
app.use('/api', transferRoutes);
app.use(internalRoutes);

app.use(errorHandler);

export default app;