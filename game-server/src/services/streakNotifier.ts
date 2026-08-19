import { Telegraf } from 'telegraf';
import { config } from '../config';

const bot = new Telegraf(config.botToken);

const CONFETTI_EFFECT_ID = '5046509860389126442';
// 5 messages per second, well inside Telegram's broadcast limit.
const MESSAGE_INTERVAL_MS = 200;
const MAX_SEND_ATTEMPTS = 3;

export type StreakBonusTier = '5_days' | '10_days' | '30_days';

const TEMPLATES: Record<StreakBonusTier, (amount: string) => string> = {
  '5_days': (amount) =>
    `እንኳን ደስ አለዎት! \nአንድም ቀን ሳይዘሉ ለ5 ቀናት በመጫወትዎ የ${amount} ብር ቦነስ አግኝተዋል። \nየ10 ቀኑን ቦነስ ለማግኘት ቀን ሳያልፉ መጫወትዎን ይቀጥሉ!`,
  '10_days': (amount) =>
    `እንኳን ደስ አለዎት! \nአንድም ቀን ሳይዘሉ ለ10 ቀናት በመጫወትዎ የ${amount} ብር ቦነስ አግኝተዋል። \nየ30 ቀኑን ቦነስ ለማግኘት ቀን ሳያልፉ መጫወትዎን ይቀጥሉ!`,
  '30_days': (amount) =>
    `እንኳን ደስ አለዎት! \nአንድም ቀን ሳይዘሉ ለ30 ቀናት በመጫወትዎ የ${amount} ብር ቦነስ አግኝተዋል። \nተጨማሪ ቦነሶችን ለማግኘት ቀን ሳያልፉ መጫወትዎን ይቀጥሉ ፤ ተጨማሪ ቦነሶችን ማግኘት እንዲችሉ የቀናት ቆጣሪዎ እንደገና ይጀምራል!`,
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Sends the bonus message to every winner of one tier, paced at one message per
 * MESSAGE_INTERVAL_MS. A failure for one user never stops the rest of the batch.
 */
export async function sendStreakBonusMessages(
  tier: StreakBonusTier,
  amount: string,
  telegramIds: number[]
): Promise<void> {
  if (telegramIds.length === 0) return;

  const text = TEMPLATES[tier](amount);
  console.log(`[streakNotifier] Sending ${tier} bonus message to ${telegramIds.length} user(s)`);

  for (let i = 0; i < telegramIds.length; i++) {
    if (i > 0) await sleep(MESSAGE_INTERVAL_MS);
    await sendWithRetry(telegramIds[i], text, tier);
  }
}

async function sendWithRetry(
  telegramId: number,
  text: string,
  tier: StreakBonusTier
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      await bot.telegram.sendMessage(telegramId, text, {
        message_effect_id: CONFETTI_EFFECT_ID,
      } as any);
      return;
    } catch (err: any) {
      const reason = err?.response?.description ?? err?.message ?? err;

      if (!isRetryableTelegramError(err) || attempt === MAX_SEND_ATTEMPTS) {
        console.error(
          `[streakNotifier] ${tier} message to ${telegramId} dropped after ${attempt} attempt(s): ${reason}`
        );
        return;
      }

      await sleep(backoffMs(err, attempt));
    }
  }
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
