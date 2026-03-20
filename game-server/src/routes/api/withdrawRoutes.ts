import { Router } from 'express';
import { verifyInitData } from '../../middlewares/verifyInitData';
import { requestWithdrawal } from '../../controllers/withdrawController';

const router = Router();

router.post('/withdrawals/request', verifyInitData, requestWithdrawal);

export default router;