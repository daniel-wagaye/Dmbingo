import { Router } from 'express';
import { gameControl } from '../controllers/gameController';

const router = Router();

router.post('/internal/game-control', gameControl);

export default router;