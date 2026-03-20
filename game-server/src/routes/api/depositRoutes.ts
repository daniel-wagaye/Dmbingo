import { Router } from 'express';
import { verifyInitData } from '../../middlewares/verifyInitData';
import { validateDeposit, getBankData } from '../../controllers/depositsController';

const router = Router();

router.post('/deposits/validate', verifyInitData, validateDeposit);
router.get('/deposits/banks', verifyInitData, getBankData);

export default router;