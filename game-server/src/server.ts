import http from 'http';
import { Telegraf } from 'telegraf';
import { Server as ColyseusServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { config } from './config';
import app from './app';
import { GameRoom, activeRoom } from './colyseus/GameRoom';
import { callRecoverGameState } from './services/gameService';
import { schedulePickingTimer } from './jobs/scheduler';
import { startCleanupCron } from './jobs/cleanupCron';

const PORT = config.port;
const bot = new Telegraf(config.botToken);
const httpServer = http.createServer(app);

const gameServer = new ColyseusServer({
  transport: new WebSocketTransport({ server: httpServer }),
});
gameServer.define('game_room', GameRoom);
matchMaker.controller.DEFAULT_CORS_HEADERS['Access-Control-Allow-Headers'] =
  'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Telegram-Init-Data, X-Telegram-Contact-Raw';

async function sendWinnerNotifications(winners: any[]): Promise<void> {
  for (const w of winners) {
    try {
      await bot.telegram.sendMessage(
        w.telegram_id,
        `🎉 Congratulations! You won ${w.amount} ETB in the last game (Board #${w.board_id}). Your withdrawal wallet has been credited!`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Play Again 🎱', url: 'https://t.me/dmbingobot/startapp' }],
            ],
          },
        }
      );
    } catch (e) {
      console.error(`[recovery] Failed to notify winner ${w.telegram_id}:`, e);
    }
  }
}

async function initializeAndRecover(): Promise<void> {
  // Pre-create the room so activeRoom is set before any client connects
  await matchMaker.createRoom('game_room', {});
  console.log('[colyseus] Game room pre-created, activeRoom:', !!activeRoom);

  // Wait for activeRoom to be set (onCreate is async in matchMaker)
  for (let i = 0; i < 20 && !activeRoom; i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (!activeRoom) {
    console.error('[colyseus] FATAL: activeRoom not set after createRoom');
  }

  // Run crash recovery
  for (let attempt = 1; attempt <= config.maxRecoveryRetries; attempt++) {
    try {
      console.log(`[recovery] Running crash recovery (attempt ${attempt})...`);
      const result = await callRecoverGameState();
      console.log('[recovery] Result:', result);

      // Send Telegram messages to winners (fire-and-forget)
      if (result?.action === 'credited_winners' && result?.winners?.length > 0) {
        sendWinnerNotifications(result.winners).catch((e) =>
          console.error('[recovery] Winner notification batch failed:', e)
        );
      }

      // Set room state from recovery return values (no extra DB query)
      console.log('[recovery] activeRoom exists:', !!activeRoom);
      console.log('[recovery] Result fields:', {
        new_game_phase: result?.new_game_phase,
        phase: result?.phase,
        picking_ends_at: result?.picking_ends_at,
        stake_amount: result?.stake_amount,
        minimum_player: result?.minimum_player,
      });
      if (activeRoom) {
        const phase = result?.new_game_phase || result?.phase || 'maintenance';
        activeRoom.setNewGame({
          phase,
          picking_ends_at: result?.picking_ends_at ?? null,
          stake_amount: result?.stake_amount ? Number(result.stake_amount) : 0,
          minimum_player: result?.minimum_player ? Number(result.minimum_player) : 0,
        });
        console.log('[recovery] Room state after setNewGame:', {
          phase: activeRoom.state.phase,
          pickingEndsAt: activeRoom.state.pickingEndsAt,
          stakeAmount: activeRoom.state.stakeAmount,
        });
      }

      // Schedule picking timer using return value directly (no getLatestGame query)
      const newPhase = result?.new_game_phase;
      if (newPhase === 'picking' && result?.picking_ends_at) {
        const delay = new Date(result.picking_ends_at).getTime() - Date.now();
        schedulePickingTimer(Math.max(delay, 0));
      }
      // maintenance or other phases → no timers needed

      return; // success
    } catch (err) {
      console.error(`[recovery] Attempt ${attempt} failed:`, err);
      if (attempt >= config.maxRecoveryRetries) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

initializeAndRecover()
  .then(async () => {
    await gameServer.listen(PORT);
    console.log(`[game-server] Express + Colyseus running on http://localhost:${PORT}`);
    startCleanupCron();
  })
  .catch((err) => {
    console.error('[recovery] All retries failed. Exiting.', err);
    process.exit(1);
  });
