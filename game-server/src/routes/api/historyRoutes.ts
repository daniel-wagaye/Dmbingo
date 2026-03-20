import { Router } from 'express';
import { verifyInitData } from '../../middlewares/verifyInitData';
import { getHistory } from '../../controllers/historyController';

const router = Router();

router.post('/history', verifyInitData, getHistory);

export default router;