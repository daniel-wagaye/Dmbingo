import { Request, Response } from 'express';
import { config } from '../config';
import { isAllowed } from '../middlewares/rateLimitPerUser';
import {
  callPickBoard,
  createNewPickingGame,
  getLatestGame,
  getGameStatus,
} from '../services/gameService';
import { getBingoCard, hasBingoPattern } from '../services/bingoValidator';
import { schedulePickingTimer } from '../jobs/scheduler';
import { startBotPicksForGame } from '../jobs/botManager';
import { activeRoom } from '../colyseus/GameRoom';

// ── Global rate limiter for game-control (not per-user) ──
const gameControlTimestamps: number[] = [];

function isGameControlAllowed(): boolean {
  const now = Date.now();
  const windowMs = config.gameControlRateLimitWindowMs;
  const max = config.gameControlRateLimitMax;
  while (gameControlTimestamps.length && now - gameControlTimestamps[0] > windowMs) {
    gameControlTimestamps.shift();
  }
  if (gameControlTimestamps.length >= max) return false;
  gameControlTimestamps.push(now);
  return true;
}

export function clearGameControlRateLimit(): void {
  gameControlTimestamps.length = 0;
}

// ── POST /api/games/:gameId/pick ──
export async function pickBoard(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;
    const boardId = req.body?.board_id;

    if (typeof boardId !== 'number' || boardId < 1 || boardId > 500) {
      res.status(400).json({ error: 'INVALID_BOARD', message: 'board_id must be 1–500' });
      return;
    }

    if (!isAllowed('pick', telegramId, config.pickRateLimitWindowMs, config.pickRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again later.' });
      return;
    }

    const result = await callPickBoard(telegramId, boardId);

    if (!result) {
      res.status(500).json({ error: 'SERVER_ERROR', message: 'Server error — try again.' });
      return;
    }

    if (result.silent === true) {
      res.status(204).end();
      return;
    }

    if (result.success === false) {
      const statusCode = result.status_code || 500;
      res.status(statusCode).json({ error: result.error, message: result.message });
      return;
    }

    // Push to Colyseus room (store winner_name from PG function)
    if (activeRoom && result.success) {
      if (result.action === 'pick') {
        activeRoom.updatePick(boardId, telegramId, false, result.winner_name || '');
      } else if (result.action === 'unpick') {
        activeRoom.updatePick(boardId, 0, false, '');
      }
    }

    res.status(200).json(result);
  } catch (err) {
    console.error('[pickBoard]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Server error — try again.' });
  }
}

// ── POST /api/games/:gameId/claim-bingo ──
export async function claimBingo(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;
    const boardIds = req.body?.board_ids;

    // Validate board_ids is an array of numbers, max 2
    if (!Array.isArray(boardIds) || boardIds.length === 0) {
      res.status(400).json({ error: 'INVALID_BOARD', message: 'board_ids array is required' });
      return;
    }
    if (boardIds.length > 2) {
      res.status(400).json({ error: 'TOO_MANY_BOARDS', message: 'Too many board numbers. Only two boards are acceptable.' });
      return;
    }
    if (!boardIds.every((id: any) => typeof id === 'number' && id >= 1 && id <= 500)) {
      res.status(400).json({ error: 'INVALID_BOARD', message: 'Invalid board number' });
      return;
    }

    if (!isAllowed('claim', telegramId, config.claimRateLimitWindowMs, config.claimRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many claims. Try again later.' });
      return;
    }

    // ── In-memory validation using Colyseus state ──
    if (!activeRoom) {
      res.status(200).json({ action: 'ignore' });
      return;
    }

    const state = activeRoom.state;

    // Must be in started phase with calling active
    if (state.phase !== 'started' || !state.callingStarted) {
      res.status(200).json({ action: 'no_bingo' });
      return;
    }

    // Build called numbers set from Colyseus state
    const shuffled = state.shuffledNums;
    const calledSet = new Set<number>();
    for (let i = 0; i < state.calledIndex && i < shuffled.length; i++) {
      calledSet.add(shuffled[i]);
    }

    // Validate each claimed board
    const winnerBoards: number[] = [];
    let winnerName = '';

    for (const bid of boardIds) {
      // Verify this board is picked by the claiming user
      const pick = state.picks.get(bid.toString());
      if (!pick || Number(pick.telegramId) !== Number(telegramId)) {
        continue; // not their board — skip
      }

      // Already marked winner — skip
      if (pick.winner) continue;

      // Get card from in-memory cache
      const card = getBingoCard(bid);
      if (!card) continue;

      // Check bingo pattern
      if (hasBingoPattern(card, calledSet)) {
        winnerBoards.push(bid);
        if (!winnerName) winnerName = pick.winnerName || '';
      }
    }

    if (winnerBoards.length === 0) {
      res.status(200).json({ action: 'no_bingo' });
      return;
    }

    // Mark winner boards in Colyseus state
    for (const wb of winnerBoards) {
      activeRoom.updatePick(wb, telegramId, true, winnerName);
    }

    // Trigger winner acceptance window (stops calling, starts finalization timer)
    const { onWinnerDetected } = await import('../jobs/caller');
    onWinnerDetected();

    res.status(200).json({
      action: 'winner',
      winner_boards: winnerBoards,
      winner_name: winnerName,
    });
  } catch (err) {
    console.error('[claimBingo]', err);
    res.status(200).json({ action: 'ignore', message: 'error' });
  }
}

// ── POST /api/games/:gameId/toggle-auto ──
export async function toggleAuto(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;
    const autoValue = req.body?.auto;

    if (typeof autoValue !== 'boolean') {
      res.status(400).json({ error: 'INVALID_VALUE', message: 'body.auto must be a boolean' });
      return;
    }

    if (!isAllowed('autoToggle', telegramId, config.autoToggleRateLimitWindowMs, config.autoToggleRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again later.' });
      return;
    }

    if (!activeRoom) {
      res.status(200).json({ success: false, error: 'NO_ROOM' });
      return;
    }

    activeRoom.setAutoForPlayer(telegramId, autoValue);

    res.status(200).json({ success: true, auto: autoValue });
  } catch (err) {
    console.error('[toggleAuto]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'No Internet — try again.' });
  }
}

// ── POST /internal/game-control ──
export async function gameControl(req: Request, res: Response): Promise<void> {
  try {
    // 1. Verify secret
    const secret = req.header('X-Game-Secret');
    if (!secret || secret !== config.gameSecret) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    // 2. Validate payload
    const body = req.body;
    if (!body || body.game !== 'Start' || Object.keys(body).length !== 1) {
      res.status(400).json({ error: 'INVALID_PAYLOAD' });
      return;
    }

    // 3. Global rate limit
    if (!isGameControlAllowed()) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });
      return;
    }

    // 4. Pre-checks (fast read-only)
    const lastGame = await getLatestGame();
    if (lastGame && lastGame.phase !== 'maintenance') {
      res.status(409).json({
        error: 'ALREADY_STARTED',
        message: 'Game already started or not in maintenance.',
      });
      return;
    }

    const status = await getGameStatus();
    if (status !== 'active') {
      res.status(409).json({
        error: 'GAME_STATUS_IS_NOT_ACTIVE',
        message: "Game status is not active. can't start game now.",
      });
      return;
    }

    // 5. Atomic create
    const newGame = await createNewPickingGame();

    // 6. Push to Colyseus room
    if (activeRoom) {
      activeRoom.setNewGame({
        phase: 'picking',
        game_id: Number(newGame.game_id),
        picking_ends_at: newGame.picking_ends_at,
        stake_amount: Number(newGame.stake_amount),
        minimum_player: Number(newGame.minimum_player),
      });
    }

    // 7. Schedule picking timer using return value directly
    const pickingEndsAt = new Date(newGame.picking_ends_at);
    const durationMs = pickingEndsAt.getTime() - Date.now();
    schedulePickingTimer(Math.max(durationMs, 0));

    // 8. Schedule the NPC/bot picks for this picking phase
    startBotPicksForGame({
      gameId: Number(newGame.game_id),
      phase: 'picking',
      pickingEndsAt: newGame.picking_ends_at,
      botStatus: newGame.bot_status,
      minBotAmount: newGame.min_bot_amount,
      maxBotAmount: newGame.max_bot_amount,
    });

    res.status(200).json({
      success: true,
      action: 'start',
      message: 'New picking phase started.',
      game_id: newGame.game_id,
    });
  } catch (err: any) {
    console.error('[gameControl]', err);
    if (err.message === 'ALREADY_STARTED') {
      res.status(409).json({ error: 'ALREADY_STARTED', message: 'Game already started or not in maintenance.' });
    } else if (err.message === 'GAME_STATUS_IS_NOT_ACTIVE') {
      res.status(409).json({ error: 'GAME_STATUS_IS_NOT_ACTIVE', message: "Game status is not active. can't start game now." });
    } else {
      res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong.' });
    }
  }
}