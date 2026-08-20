import { Router } from 'express';
import { verifyInitData } from '../../middlewares/verifyInitData';
import { getLeaderboard, getLeaderboardHistory } from '../../controllers/leaderboardController';

const router = Router();

router.post('/leaderboard', verifyInitData, getLeaderboard);
router.post('/leaderboard/history', verifyInitData, getLeaderboardHistory);

export default router;
