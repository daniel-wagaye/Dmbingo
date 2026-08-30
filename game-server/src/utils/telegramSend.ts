import { Telegraf } from 'telegraf';
import { config } from '../config';

const bot = new Telegraf(config.botToken);

// 5 messages per second, well inside Telegram's broadcast limit.
const MESSAGE_INTERVAL_MS = 200;
const MAX_SEND_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface PacedMessage {
  telegram_id: number;
  text: string;
  /** Extra sendMessage options, e.g. `message_effect_id` or `reply_markup`. */
  extra?: Record<string, unknown>;
}

/** Rate limits and server-side faults are worth retrying; a blocked or unknown chat is not. */
function isRetryableTelegramError(err: any): boolean {
  const code = err?.response?.error_code;
  if (typeof code === 'number') return code === 429 || code >= 500;
  // No HTTP response at all — network timeout or reset.
  return true;
}

function backoffMs(err: any, attempt: number): number {
  const base = 1000 * Math.pow(2, attempt - 1);
  // Telegram tells us exactly how long to wait on a 429; never come back sooner.
  const retryAfter = Number(err?.response?.parameters?.retry_after);
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.max(base, retryAfter * 1000)
    : base;
}

/** Sends one message, retrying only errors that can succeed later. Never throws. */
export async function sendWithRetry(
  telegramId: number,
  text: string,
  label: string,
  extra?: Record<string, unknown>
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      await bot.telegram.sendMessage(telegramId, text, (extra ?? {}) as any);
      return true;
    } catch (err: any) {
      const reason = err?.response?.description ?? err?.message ?? err;

      if (!isRetryableTelegramError(err) || attempt === MAX_SEND_ATTEMPTS) {
        console.error(
          `[${label}] message to ${telegramId} dropped after ${attempt} attempt(s): ${reason}`
        );
        return false;
      }

      await sleep(backoffMs(err, attempt));
    }
  }
  return false;
}

/**
 * Sends a batch one message at a time, paced so the bot stays under Telegram's limit.
 * A failure for one recipient never stops the rest of the batch.
 */
export async function sendPaced(messages: PacedMessage[], label: string): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await sleep(MESSAGE_INTERVAL_MS);
    const m = messages[i];
    await sendWithRetry(m.telegram_id, m.text, label, m.extra);
  }
}
