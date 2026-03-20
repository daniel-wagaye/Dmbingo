import { config } from '../config';
import { clearAllRateLimits } from '../middlewares/rateLimitPerUser';
import { clearGameControlRateLimit } from '../controllers/gameController';

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

function getNextRunMs(): number {
  const [hours, minutes] = config.rateLimitCleanupTimeUtc.split(':').map(Number);
  const now = new Date();
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hours || 0,
    minutes || 0,
    0,
    0
  ));

  // If the target time has already passed today, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return target.getTime() - now.getTime();
}

function runCleanup(): void {
  const perUserCleared = clearAllRateLimits();
  clearGameControlRateLimit();

  console.log(`[cleanup] Rate limit maps cleared at ${new Date().toISOString()}. Per-user entries removed: ${perUserCleared}`);

  // Schedule next run (tomorrow at the same time)
  scheduleNextCleanup();
}

function scheduleNextCleanup(): void {
  if (cleanupTimer) clearTimeout(cleanupTimer);

  const delayMs = getNextRunMs();
  const nextRunDate = new Date(Date.now() + delayMs);

  console.log(`[cleanup] Next rate limit cleanup scheduled at ${nextRunDate.toISOString()} (in ${Math.round(delayMs / 60000)}min)`);

  cleanupTimer = setTimeout(runCleanup, delayMs);
}

export function startCleanupCron(): void {
  scheduleNextCleanup();
}
