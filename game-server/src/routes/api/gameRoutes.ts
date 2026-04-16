import { Router, Request, Response } from 'express';
import { verifyInitData } from '../../middlewares/verifyInitData';
import { pickBoard, claimBingo, toggleAuto } from '../../controllers/gameController';
import { activeRoom } from '../../colyseus/GameRoom';

const router = Router();

router.post('/games/:gameId/pick', verifyInitData, pickBoard);
router.post('/games/:gameId/claim-bingo', verifyInitData, claimBingo);
router.post('/games/:gameId/toggle-auto', verifyInitData, toggleAuto);

router.get('/game-phase', verifyInitData, (_req: Request, res: Response) => {
  if (activeRoom) {
    res.json({ phase: activeRoom.state.phase });
  } else {
    res.json({ phase: 'maintenance' });
  }
});

export default router;