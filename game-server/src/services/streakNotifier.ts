import { sendPaced } from '../utils/telegramSend';

const CONFETTI_EFFECT_ID = '5046509860389126442';

export type StreakBonusTier = '5_days' | '10_days' | '30_days';

const TEMPLATES: Record<StreakBonusTier, (amount: string) => string> = {
  '5_days': (amount) =>
    `እንኳን ደስ አለዎት! \nአንድም ቀን ሳይዘሉ ለ5 ቀናት በመጫወትዎ የ${amount} ብር ቦነስ አግኝተዋል። \nየ10 ቀኑን ቦነስ ለማግኘት ቀን ሳያልፉ መጫወትዎን ይቀጥሉ!`,
  '10_days': (amount) =>
    `እንኳን ደስ አለዎት! \nአንድም ቀን ሳይዘሉ ለ10 ቀናት በመጫወትዎ የ${amount} ብር ቦነስ አግኝተዋል። \nየ30 ቀኑን ቦነስ ለማግኘት ቀን ሳያልፉ መጫወትዎን ይቀጥሉ!`,
  '30_days': (amount) =>
    `እንኳን ደስ አለዎት! \nአንድም ቀን ሳይዘሉ ለ30 ቀናት በመጫወትዎ የ${amount} ብር ቦነስ አግኝተዋል። \nተጨማሪ ቦነሶችን ለማግኘት ቀን ሳያልፉ መጫወትዎን ይቀጥሉ ፤ ተጨማሪ ቦነሶችን ማግኘት እንዲችሉ የቀናት ቆጣሪዎ እንደገና ይጀምራል!`,
};

/**
 * Sends the bonus message to every winner of one tier, paced by the shared sender.
 * A failure for one user never stops the rest of the batch.
 */
export async function sendStreakBonusMessages(
  tier: StreakBonusTier,
  amount: string,
  telegramIds: number[]
): Promise<void> {
  if (telegramIds.length === 0) return;

  const text = TEMPLATES[tier](amount);
  console.log(`[streakNotifier] Sending ${tier} bonus message to ${telegramIds.length} user(s)`);

  await sendPaced(
    telegramIds.map((telegram_id) => ({
      telegram_id,
      text,
      extra: { message_effect_id: CONFETTI_EFFECT_ID },
    })),
    `streakNotifier:${tier}`
  );
}
