import { Router } from 'express';
import { couponFinishedWebhook } from '../controllers/couponWebhookController';

const router = Router();

router.post('/coupon-finished', couponFinishedWebhook);

export default router;
