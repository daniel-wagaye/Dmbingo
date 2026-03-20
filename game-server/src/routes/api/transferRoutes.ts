import { Router } from 'express';
import { verifyInitData } from '../../middlewares/verifyInitData';
import { sendTransfer } from '../../controllers/transferController';

const router = Router();

router.post('/transfers/send', verifyInitData, sendTransfer);

export default router;