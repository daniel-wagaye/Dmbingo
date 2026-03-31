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
import { startHealthChecks } from './utils/health';

const PORT = config.port;
const bot = new Telegraf(config.botToken);
let botLaunched = false;
let botLaunchTimer: ReturnType<typeof setTimeout> | null = null;

// ─ /start command handler (always replies) ─
bot.command('start', async (ctx) => {
  try {
    const userName = ctx.from?.first_name || 'ጓደኛዬ';
    const text = `ሰላም! ${userName}\n🔥 ወደ DMbingo  እንኳን በደህና መጡ! 🎮✨\n\n🚀 ተጫወቱ፣ አሸንፉ እና ትልቅ ሽልማት ያግኙ! 💎\n\n🎯 የእርስዎ እድል ዛሬ ይጀምራል! 🌟\n💰 የሚጠብቅዎት:\n⚡️ ፈጣን ጨዋታዎች\n🎊 ትልቅ ሽልማቶች\n🎁 ቀን በቀን ትልቅ የቦነስ ስጦታወች በዚ  ግሩፕ ላይ ይለቀቃሉ\n💬Join our community to get daily reward's 💰\n🔥 አሁኑኑ ይጀምሩ እና ያሸንፉ! 🚀`;
    const keyboard = {
      inline_keyboard: [
        [{ text: '📢 Join Community', url: 'https://t.me/DM_Bingo' }],
        [{ text: '🎮 Play Now', url: 'https://t.me/dmbingobot/startapp' }],
      ],
    };
    const photoId = config.startCommandPhotoId.trim();
    if (!photoId) {
      await ctx.reply(text, { reply_markup: keyboard });
      return;
    }
    try {
      await ctx.replyWithPhoto(photoId, {
        caption: text,
        reply_markup: keyboard,
      });
    } catch (photoErr) {
      console.error('[bot] /start photo send failed, falling back to text:', photoErr);
      await ctx.reply(text, { reply_markup: keyboard });
    }
  } catch (err) {
    console.error('[bot] /start reply failed:', err);
  }
});

const scheduleBotLaunchRetry = (attempt: number) => {
  if (botLaunched || botLaunchTimer) {
    return;
  }
  const delay = Math.min(3000 * attempt, 30000);
  botLaunchTimer = setTimeout(() => {
    botLaunchTimer = null;
    void launchBotPolling(attempt + 1);
  }, delay);
};

const launchBotPolling = async (attempt = 1): Promise<void> => {
  if (botLaunched) {
    return;
  }
  try {
    await bot.launch({ dropPendingUpdates: true });
    botLaunched = true;
    console.log('[bot] Telegram bot launched (polling)');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('terminated by other getUpdates request')) {
      console.error('[bot] Polling conflict (409). Another process is using this bot token.');
    }
    console.error(`[bot] Failed to launch (attempt ${attempt}):`, err);
    scheduleBotLaunchRetry(attempt);
  }
};
const httpServer = http.createServer(app);

// ── HTTP server error resilience ──
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  console.error('[httpServer] Error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`[httpServer] Port ${PORT} in use. Retrying in 5s...`);
    setTimeout(() => {
      httpServer.close();
      httpServer.listen(PORT);
    }, 5000);
  }
});

httpServer.on('close', () => {
  console.warn('[httpServer] Server closed unexpectedly. Rebinding in 3s...');
  setTimeout(() => {
    try {
      httpServer.listen(PORT, () => {
        console.log(`[httpServer] Re-bound to port ${PORT}`);
      });
    } catch (e) {
      console.error('[httpServer] Rebind failed:', e);
    }
  }, 3000);
});

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
          game_id: result?.new_game_id ? Number(result.new_game_id) : 0,
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
      if (attempt >= config.maxRecoveryRetries) {
        if (activeRoom) {
          activeRoom.setNewGame({
            phase: 'maintenance',
            picking_ends_at: null,
            stake_amount: 0,
            minimum_player: 0,
          });
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRecoveryRetry(): void {
  if (recoveryRetryTimer) {
    return;
  }
  recoveryRetryTimer = setTimeout(async () => {
    recoveryRetryTimer = null;
    await initializeAndRecover();
    if (activeRoom?.state.phase === 'maintenance') {
      scheduleRecoveryRetry();
    }
  }, 30000);
}

// Global safety nets — prevent unhandled errors from crashing the process
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (process kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection (process kept alive):', reason);
});

initializeAndRecover()
  .then(async () => {
    void launchBotPolling();
    await gameServer.listen(PORT);
    console.log(`[game-server] Express + Colyseus running on http://localhost:${PORT}`);
    startCleanupCron();
    startHealthChecks();
    if (activeRoom?.state.phase === 'maintenance') {
      scheduleRecoveryRetry();
    }
  })
  .catch((err) => {
    console.error('[recovery] Unexpected startup failure. Continuing in degraded mode.', err);
    void launchBotPolling();
    gameServer.listen(PORT).then(() => {
      console.log(`[game-server] Express + Colyseus running on http://localhost:${PORT}`);
      startCleanupCron();
      startHealthChecks();
      scheduleRecoveryRetry();
    }).catch((listenErr) => {
      console.error('[startup] Failed to bind server:', listenErr);
      process.exit(1);
    });
  });
