import { Router } from 'express';
import { getUser, register, patchLanguage, patchName } from '../../controllers/userController';
import { verifyInitData } from '../../middlewares/verifyInitData';

const router = Router();

router.get('/user', verifyInitData, getUser);
router.post('/register', verifyInitData, register);
router.patch('/user/language', verifyInitData, patchLanguage);
router.patch('/user/name', verifyInitData, patchName);

export default router;