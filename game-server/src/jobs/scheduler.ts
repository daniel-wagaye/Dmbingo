import { callTransitionPicking } from '../services/gameService';
import { startCallingLoop } from './caller';
import { stopBotPicks } from './botManager';
import { activeRoom } from '../colyseus/GameRoom';

let pickingTimer: ReturnType<typeof setTimeout> | null = null;

export function clearPickingTimer(): void {
  if (pickingTimer) {
    clearTimeout(pickingTimer);
    pickingTimer = null;
  }
}

export function schedulePickingTimer(delayMs: number): void {
  clearPickingTimer();
  console.log(`[scheduler] Picking timer set for ${Math.round(delayMs / 1000)}s`);

  pickingTimer = setTimeout(async () => {
    pickingTimer = null;
    try {
      // callTransitionPicking already has 30-retry logic inside gameService
      const result = await callTransitionPicking();
      console.log('[scheduler] transition_picking result:', result);

      if (!result || !result.success) {
        console.error('[scheduler] transition_picking failed:', result);
        schedulePickingTimer(30000);
        return;
      }

      if (result.action === 'extended') {
        const newEndsAtMs = new Date(result.new_picking_ends_at).getTime();
        const newDelay = newEndsAtMs - Date.now();
        console.log(`[scheduler] Extended picking — ${result.player_count}/${result.minimum_player} players. Rescheduling ${Math.round(newDelay / 1000)}s`);

        if (activeRoom) {
          activeRoom.setPickingEndsAt(newEndsAtMs);
        }

        schedulePickingTimer(Math.max(newDelay, 0));
      } else if (result.action === 'started') {
        console.log(`[scheduler] Game ${result.game_id} started with ${result.player_count} players. Prize: ${result.prize_amount}`);

        stopBotPicks();

        if (activeRoom) {
          activeRoom.startGame(
            result.shuffled_nums,
            Number(result.prize_amount),
            result.player_count
          );
        }

        startCallingLoop(result.game_id, result.shuffled_nums);
      }
    } catch (err: any) {
      if (err?.code === 'P0001' && err?.hint?.includes('picking phase')) {
        console.log('[scheduler] Game already left picking phase. Stopping scheduler.');
        return;
      }
      console.error('[scheduler] transition_picking failed after all retries. Rescheduling in 30s.', err?.message);
      schedulePickingTimer(30000);
    }
  }, delayMs);
}