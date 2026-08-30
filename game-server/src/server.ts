import http from 'http';
import { Telegraf } from 'telegraf';
import { Server as ColyseusServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { config } from './config';
import app from './app';
import { GameRoom, activeRoom } from './colyseus/GameRoom';
import { callRecoverGameState } from './services/gameService';
import { settleWinnersFromDisk } from './services/crashWinnerRecovery';
import { pruneWinnerFilesBelow } from './services/winnerRecoveryStore';
import { schedulePickingTimer } from './jobs/scheduler';
import { startBotPicksForGame, stopBotPicks } from './jobs/botManager';
import { startCleanupCron } from './jobs/cleanupCron';
import { startHealthChecks } from './utils/health';
import { raiseAlert, resolveAlert } from './services/alerter';
import { errorText } from './jobs/criticalRetry';

const PORT = config.port;
const bot = new Telegraf(config.botToken);
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

let roomCreated = false;

async function ensureGameRoom(): Promise<void> {
  if (roomCreated) return;
  await matchMaker.createRoom('game_room', {});
  roomCreated = true;
  console.log('[colyseus] Game room pre-created, activeRoom:', !!activeRoom);

  for (let i = 0; i < 20 && !activeRoom; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!activeRoom) {
    console.error('[colyseus] FATAL: activeRoom not set after createRoom');
    raiseAlert('colyseus_room', 'Game room failed to become active after createRoom');
  }
}

function parkInMaintenance(): void {
  stopBotPicks();
  if (activeRoom) {
    activeRoom.setNewGame({
      phase: 'maintenance',
      picking_ends_at: null,
      stake_amount: 0,
      minimum_player: 0,
    });
  }
}

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
  await ensureGameRoom();

  for (let attempt = 1; attempt <= config.maxRecoveryRetries; attempt++) {
    try {
      console.log(`[recovery] Running crash recovery (attempt ${attempt})...`);

      // Pay out first if the process died between winner detection and finalize_game.
      // This leaves the game in winner_reveal, which recover_game_state already knows how to
      // finish; in every other case it does nothing and recovery proceeds unchanged.
      const settled = await settleWinnersFromDisk();

      if (settled.blocked) {
        raiseAlert(
          `settle:${settled.gameId ?? 'unknown'}`,
          `Could not settle winners from disk for game ${settled.gameId}`,
          { operation: 'settleWinnersFromDisk', game_id: settled.gameId, attempt }
        );
        throw new Error('WINNER_SETTLE_BLOCKED');
      }

      const result = await callRecoverGameState();
      console.log('[recovery] Result:', result);

      // A settled game already announced its own winners with the crash-specific message.
      if (!settled.settled && result?.action === 'credited_winners' && result?.winners?.length > 0) {
        sendWinnerNotifications(result.winners).catch((e) =>
          console.error('[recovery] Winner notification batch failed:', e)
        );
      }

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

      const newPhase = result?.new_game_phase;
      if (newPhase === 'picking' && result?.picking_ends_at) {
        const delay = new Date(result.picking_ends_at).getTime() - Date.now();
        schedulePickingTimer(Math.max(delay, 0));
      }

      startBotPicksForGame({
        gameId: result?.new_game_id ? Number(result.new_game_id) : 0,
        phase: newPhase ?? result?.phase ?? 'maintenance',
        pickingEndsAt: result?.picking_ends_at,
        botStatus: result?.bot_status,
        minBotAmount: result?.min_bot_amount,
        maxBotAmount: result?.max_bot_amount,
      });

      const liveGameId = Number(result?.new_game_id ?? result?.game_id ?? 0);
      if (liveGameId > 0) {
        pruneWinnerFilesBelow(liveGameId).catch((e) =>
          console.error('[recovery] Winner file prune failed:', e)
        );
      }

      resolveAlert('recovery', 'Crash recovery succeeded', {
        action: result?.action,
        new_game_id: result?.new_game_id,
        phase: newPhase ?? result?.phase,
      });
      if (settled.gameId) {
        resolveAlert(`settle:${settled.gameId}`, `Winner settle succeeded for game ${settled.gameId}`);
      }
      return;
    } catch (err) {
      console.error(`[recovery] Attempt ${attempt} failed:`, err);
      raiseAlert('recovery', 'Crash recovery failed', {
        operation: 'recover_game_state',
        attempt,
        max_attempts: config.maxRecoveryRetries,
        error: errorText(err),
      });
      if (attempt >= config.maxRecoveryRetries) {
        parkInMaintenance();
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

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception (process kept alive):', err);
  raiseAlert('uncaught_exception', 'Uncaught exception — process kept alive', {
    error: errorText(err),
  });
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection (process kept alive):', reason);
  raiseAlert('unhandled_rejection', 'Unhandled rejection — process kept alive', {
    error: errorText(reason),
  });
});

async function boot(): Promise<void> {
  await gameServer.listen(PORT);
  console.log(`[game-server] Express + Colyseus running on http://localhost:${PORT}`);
  startCleanupCron();
  startHealthChecks();

  await ensureGameRoom();
  parkInMaintenance();

  await initializeAndRecover();
  if (activeRoom?.state.phase === 'maintenance') {
    scheduleRecoveryRetry();
  }
}

boot().catch((err) => {
  console.error('[recovery] Unexpected startup failure. Continuing in degraded mode.', err);
  raiseAlert('startup', 'Unexpected startup failure — running in degraded mode', {
    error: errorText(err),
  });
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
