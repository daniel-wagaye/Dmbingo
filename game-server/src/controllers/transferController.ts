import { Request, Response } from 'express';
import { Telegraf } from 'telegraf';
import { config } from '../config';
import { isAllowed } from '../middlewares/rateLimitPerUser';
import { userSql as sql } from '../db/drizzle';

const bot = new Telegraf(config.botToken);
const PHONE_RE = /^(09|07)\d{8}$/;

function roundHalfUp(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor + Number.EPSILON) / factor;
}

export async function sendTransfer(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;

    // 1. Rate limit
    if (!isAllowed('transfer', telegramId, config.transferRateLimitWindowMs, config.transferRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many transfers. Try again later.' });
      return;
    }

    // 2. Sanitize inputs
    let { from_wallet, amount, recipient_phone } = req.body;

    if (!from_wallet || !['withdrawal', 'non_withdrawal'].includes(from_wallet)) {
      res.status(400).json({ error: 'INVALID_WALLET', message: 'Invalid wallet selection' });
      return;
    }

    // Sanitize amount: strip whitespace, leading zeros
    let amountStr = String(amount || '').replace(/\s/g, '');
    amountStr = amountStr.replace(/^0+/, '') || '0';

    if (amountStr.length > 4) {
      res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Transfer amount must be less than or equal to 1000' });
      return;
    }

    const amountNum = parseInt(amountStr, 10);
    if (isNaN(amountNum) || !Number.isInteger(amountNum)) {
      res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Only whole number please' });
      return;
    }
    if (amountNum < 10) {
      res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Transfer amount must be greater than or equal to 10' });
      return;
    }
    if (amountNum > 1000) {
      res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Transfer amount must be less than or equal to 1000' });
      return;
    }

    // Sanitize phone
    let phone = String(recipient_phone || '').replace(/\s/g, '');
    if (phone.length !== 10 || !PHONE_RE.test(phone)) {
      res.status(400).json({ error: 'INVALID_PHONE', message: 'The user number is not correct' });
      return;
    }

    // 3. Commission calculation
    const commission = roundHalfUp(amountNum * config.transferCommissionPercent / 100, 2);
    const total = roundHalfUp(amountNum + commission, 2);

    // 4. Normalize phone: 0912345678 → +251912345678
    const normalizedPhone = '+251' + phone.slice(1);

    // 5. Look up recipient
    const recipientRows = await sql`
      SELECT telegram_id, first_name FROM users WHERE phone_number = ${normalizedPhone} LIMIT 1
    `;
    if (recipientRows.length === 0) {
      res.status(400).json({ error: 'USER_NOT_FOUND', message: "User doesn't exist" });
      return;
    }

    const recipientId = Number(recipientRows[0].telegram_id);
    const senderIdNum = Number(telegramId);
    if (recipientId === senderIdNum) {
      res.status(400).json({ error: 'SELF_TRANSFER', message: "You can't transfer to yourself" });
      return;
    }

    // 6. Atomic transaction
    const walletCol = from_wallet === 'withdrawal' ? 'withdrawal_wallet' : 'non_withdrawal_wallet';

    const result = await sql.begin(async (tx: any) => {
      // Lock both users in deadlock-safe order
      const [id1, id2] = [senderIdNum, recipientId].sort((a, b) => a - b);
      const lockedUsers = await tx`
        SELECT telegram_id, withdrawal_wallet, non_withdrawal_wallet FROM users
        WHERE telegram_id = ${id1} OR telegram_id = ${id2}
        ORDER BY telegram_id
        FOR UPDATE
      `;

      const sender = lockedUsers.find((u: any) => Number(u.telegram_id) === senderIdNum);
      const receiver = lockedUsers.find((u: any) => Number(u.telegram_id) === recipientId);
      if (!sender || !receiver) {
        return { status: 400, body: { error: 'USER_NOT_FOUND', message: "User doesn't exist" } };
      }

      const senderBalance = parseFloat(sender[walletCol]);
      if (senderBalance < total) {
        return { status: 400, body: { error: 'INSUFFICIENT_BALANCE', message: 'Insufficient Balance' } };
      }

      // Debit sender (amount + commission) — use raw SQL for dynamic column
      if (from_wallet === 'withdrawal') {
        await tx`
          UPDATE users SET withdrawal_wallet = withdrawal_wallet - ${total}
          WHERE telegram_id = ${telegramId}
        `;
      } else {
        await tx`
          UPDATE users SET non_withdrawal_wallet = non_withdrawal_wallet - ${total}
          WHERE telegram_id = ${telegramId}
        `;
      }

      // Credit receiver (amount only, no commission)
      if (from_wallet === 'withdrawal') {
        await tx`
          UPDATE users SET withdrawal_wallet = withdrawal_wallet + ${amountNum}
          WHERE telegram_id = ${recipientId}
        `;
      } else {
        await tx`
          UPDATE users SET non_withdrawal_wallet = non_withdrawal_wallet + ${amountNum}
          WHERE telegram_id = ${recipientId}
        `;
      }

      // Insert history
      await tx`
        INSERT INTO transfer_history (sender_id, receiver_id, wallet, amount, commission, created_at)
        VALUES (${telegramId}, ${recipientId}, ${from_wallet}, ${amountNum}, ${commission}, NOW())
      `;

      return { status: 200, body: { success: true, amount: amountNum, commission, phone } };
    });

    res.status(result.status).json(result.body);

    // 7. Post-commit: Telegram message to recipient (fire-and-forget)
    if (result.status === 200) {
      const senderRows = await sql`SELECT first_name FROM users WHERE telegram_id = ${telegramId}`;
      const senderName = senderRows[0]?.first_name || 'Someone';
      const walletType = from_wallet === 'withdrawal' ? 'withdrawal' : 'non-withdrawal';

      // Fetch recipient fresh balances
      const freshRecipient = await sql`
        SELECT withdrawal_wallet, non_withdrawal_wallet FROM users WHERE telegram_id = ${recipientId}
      `;
      const totalWallet = freshRecipient.length > 0
        ? (parseFloat(freshRecipient[0].withdrawal_wallet) + parseFloat(freshRecipient[0].non_withdrawal_wallet)).toFixed(2)
        : '0.00';

      bot.telegram.sendMessage(
        recipientId,
        `እንኳን ደስ አለዎት! 🎉 \nከ${senderName} የ${amountNum} ብር ገቢ ወደ ${walletType} ዋሌትዎ ገቢ ሆኗል። 💰\nጠቅላላ የዋሌትዎ ቀሪ ሂሳብ፡ ${totalWallet} ብር.`,
        {
          // This ID triggers "Heart" (❤️) effect in Telegram
          message_effect_id: "5159385139981059251"
        } as any
      ).catch((e) => console.error('[transfer] telegram msg failed:', e));
    }
  } catch (err) {
    console.error('[sendTransfer]', err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}