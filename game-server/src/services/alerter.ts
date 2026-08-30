import { config } from '../config';
import { sendWithRetry } from '../utils/telegramSend';

/**
 * Operator alerting over Telegram.
 *
 * Deliberately has no database dependency: the failures worth waking someone up for are
 * mostly database failures, so this path has to keep working when Postgres does not.
 *
 * Repeating faults are deduplicated by key. A stuck finalize_game retrying every 30s would
 * otherwise send hundreds of messages and get the bot rate-limited exactly when the alert
 * matters, so a key re-notifies at most once per cooldown window with an occurrence count.
 */

export type AlertSeverity = 'critical' | 'warning';

interface AlertState {
  firstAt: number;
  lastSentAt: number;
  occurrences: number;
  notifications: number;
  severity: AlertSeverity;
  title: string;
}

const active = new Map<string, AlertState>();

const ICON: Record<AlertSeverity, string> = {
  critical: '🚨',
  warning: '⚠️',
};

// Sends are chained so a burst of alerts cannot interleave or flood Telegram.
let queue: Promise<unknown> = Promise.resolve();

function enqueueSend(text: string): void {
  if (!config.alertTelegramId) return;
  queue = queue
    .then(() => sendWithRetry(config.alertTelegramId, text, 'alerter'))
    .catch((err) => console.error('[alerter] Failed to deliver alert:', err));
}

function formatDetails(details?: Record<string, unknown>): string {
  if (!details) return '';
  const lines = Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `• ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/**
 * Reports an ongoing fault. Safe to call on every failed attempt — the first call notifies
 * immediately, later calls only count until the cooldown window elapses.
 */
export function raiseAlert(
  key: string,
  title: string,
  details?: Record<string, unknown>,
  severity: AlertSeverity = 'critical'
): void {
  const now = Date.now();
  const existing = active.get(key);

  if (!existing) {
    active.set(key, {
      firstAt: now,
      lastSentAt: now,
      occurrences: 1,
      notifications: 1,
      severity,
      title,
    });
    console.error(`[alerter] ${severity.toUpperCase()}: ${title}`, details ?? '');
    enqueueSend(`${ICON[severity]} ${title}${formatDetails(details)}`);
    return;
  }

  existing.occurrences++;
  existing.severity = severity;
  existing.title = title;

  if (now - existing.lastSentAt < config.alertCooldownMs) return;

  existing.lastSentAt = now;
  existing.notifications++;
  const stillFailing =
    `${ICON[severity]} STILL FAILING — ${title}` +
    formatDetails({
      ...details,
      occurrences: existing.occurrences,
      failing_for: formatDuration(now - existing.firstAt),
    });
  console.error(`[alerter] ${severity.toUpperCase()} (repeat): ${title}`, details ?? '');
  enqueueSend(stillFailing);
}

/**
 * Clears a fault. Only notifies if the matching alert was actually announced, so a call on a
 * healthy path costs nothing.
 */
export function resolveAlert(key: string, message: string, details?: Record<string, unknown>): void {
  const existing = active.get(key);
  if (!existing) return;
  active.delete(key);

  console.log(`[alerter] RESOLVED: ${message}`);
  enqueueSend(
    `✅ RESOLVED — ${message}` +
      formatDetails({
        ...details,
        failed_attempts: existing.occurrences,
        down_for: formatDuration(Date.now() - existing.firstAt),
      })
  );
}

/** One-off notice with no dedup, for events that cannot repeat in a loop. */
export function notifyOperator(title: string, details?: Record<string, unknown>): void {
  console.log(`[alerter] ${title}`, details ?? '');
  enqueueSend(`ℹ️ ${title}${formatDetails(details)}`);
}

export function isAlertActive(key: string): boolean {
  return active.has(key);
}

/** Test seam. */
export function _resetAlerts(): void {
  active.clear();
}

if (!config.alertTelegramId) {
  console.warn(
    '[alerter] ALERT_TELEGRAM_ID is not set — failures will be logged but not sent to Telegram.'
  );
}
