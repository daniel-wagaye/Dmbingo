import { Router } from 'express';
import { verifyInitData } from '../../middlewares/verifyInitData';
import { redeemCoupon } from '../../controllers/couponController';

const router = Router();

router.post('/coupons/redeem', verifyInitData, redeemCoupon);

export default router;