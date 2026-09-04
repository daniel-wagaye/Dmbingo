import { callTransitionPicking, getLatestGame } from '../services/gameService';
import { startCallingLoop } from './caller';
import { stopBotPicks } from './botManager';
import { startStreakUpdate, collectPlayerTelegramIds } from '../services/streakService';
import { startRecordHumanBoards } from '../services/realPlayerCount';
import { activeRoom } from '../colyseus/GameRoom';
import { raiseAlert, resolveAlert } from '../services/alerter';
import { delayForAttempt, errorText } from './criticalRetry';

let pickingTimer: ReturnType<typeof setTimeout> | null = null;
let pickingFailAttempt = 0;

export function clearPickingTimer(): void {
  if (pickingTimer) {
    clearTimeout(pickingTimer);
    pickingTimer = null;
  }
}

function retryPicking(reason: string, details?: Record<string, unknown>): void {
  pickingFailAttempt++;
  raiseAlert('transition_picking', 'transition_picking failed', {
    operation: 'transition_picking',
    attempt: pickingFailAttempt,
    reason,
    ...details,
  });
  schedulePickingTimer(delayForAttempt(pickingFailAttempt - 1));
}

export function schedulePickingTimer(delayMs: number): void {
  clearPickingTimer();
  console.log(`[scheduler] Picking timer set for ${Math.round(delayMs / 1000)}s`);

  pickingTimer = setTimeout(async () => {
    pickingTimer = null;
    try {
      const result = await callTransitionPicking();
      console.log('[scheduler] transition_picking result:', result);

      if (!result || !result.success) {
        console.error('[scheduler] transition_picking failed:', result);
        retryPicking(result?.error ?? 'no_success', { result });
        return;
      }

      pickingFailAttempt = 0;
      resolveAlert('transition_picking', 'transition_picking succeeded', {
        action: result.action,
        game_id: result.game_id,
      });

      if (result.action === 'extended') {
        const newEndsAtMs = new Date(result.new_picking_ends_at).getTime();
        const newDelay = newEndsAtMs - Date.now();
        console.log(
          `[scheduler] Extended picking — ${result.player_count}/${result.minimum_player} players. Rescheduling ${Math.round(newDelay / 1000)}s`
        );

        if (activeRoom) {
          activeRoom.setPickingEndsAt(newEndsAtMs);
        }

        schedulePickingTimer(Math.max(newDelay, 0));
      } else if (result.action === 'started') {
        console.log(
          `[scheduler] Game ${result.game_id} started with ${result.player_count} players. Prize: ${result.prize_amount}`
        );

        stopBotPicks();

        if (activeRoom) {
          activeRoom.startGame(
            result.shuffled_nums,
            Number(result.prize_amount),
            result.player_count
          );
        }

        // Background — never blocks the calling loop.
        startStreakUpdate(collectPlayerTelegramIds());
        startRecordHumanBoards(result.game_id);

        startCallingLoop(result.game_id, result.shuffled_nums);
      }
    } catch (err: any) {
      if (err?.code === 'P0001') {
        try {
          const latest = await getLatestGame();
          if (!latest || latest.phase !== 'picking') {
            console.log(
              `[scheduler] Game already left picking phase (${latest?.phase ?? 'none'}). Stopping scheduler.`
            );
            pickingFailAttempt = 0;
            resolveAlert('transition_picking', 'transition_picking stopped — game left picking', {
              phase: latest?.phase,
            });
            return;
          }
        } catch (lookupErr) {
          console.error('[scheduler] Could not confirm phase after P0001:', lookupErr);
        }
      }
      console.error('[scheduler] transition_picking failed after inner retries.', err?.message);
      retryPicking(errorText(err));
    }
  }, delayMs);
}
