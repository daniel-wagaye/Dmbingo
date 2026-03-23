import { Request, Response } from 'express';
import { Telegraf } from 'telegraf';
import { config } from '../config';
import { isAllowed } from '../middlewares/rateLimitPerUser';
import { sql } from '../db/drizzle';

const bot = new Telegraf(config.botToken);

const BANK_ACCOUNT_RULES: Record<string, RegExp> = {
  CBE: /^\d{6,15}$/,
  BOA: /^\d{6,15}$/,
  Telebirr: /^09\d{8}$/,
  CBEbirr: /^(09|07)\d{8}$/,
};

const VALID_BANKS = Object.keys(BANK_ACCOUNT_RULES);
const NAME_RE = /^[A-Za-z\s]{1,20}$/;

export async function requestWithdrawal(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;

    // 1. Rate limit
    if (!isAllowed('withdraw', telegramId, config.withdrawRateLimitWindowMs, config.withdrawRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many withdrawal requests. Try again in a minute.' });
      return;
    }

    // 2. Pending withdrawals check
    const pendingRows = await sql`
      SELECT COUNT(*)::int AS pending_count FROM withdrawals_request
      WHERE telegram_id = ${telegramId} AND status = 'pending'
    `;
    if (pendingRows[0].pending_count >= config.withdrawMaxPending) {
      res.status(429).json({ error: 'PENDING_LIMIT', message: `You already have ${config.withdrawMaxPending} pending withdrawals. Please wait for processing.` });
      return;
    }

    // 3. Extract and validate inputs
    const { amount, bank, account_holder_name, account_num } = req.body;

    if (typeof amount !== 'number' || amount < 100) {
      res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Withdraw amount must be greater than or equal to 100' });
      return;
    }

    if (!account_holder_name || typeof account_holder_name !== 'string' || !NAME_RE.test(account_holder_name.trim())) {
      res.status(400).json({ error: 'INVALID_NAME', message: 'Please enter a valid account holder name' });
      return;
    }

    if (!bank || !VALID_BANKS.includes(bank)) {
      res.status(400).json({ error: 'INVALID_BANK', message: 'Invalid bank selection' });
      return;
    }

    if (!account_num || typeof account_num !== 'string' || !BANK_ACCOUNT_RULES[bank].test(account_num.trim())) {
      res.status(400).json({ error: 'INVALID_ACCOUNT', message: 'The account number is not correct' });
      return;
    }

    const trimmedName = account_holder_name.trim();
    const trimmedAccount = account_num.trim();

    // 4. Atomic transaction: insert request + debit wallet
    const result = await sql.begin(async (tx: any) => {
      // Check wallet balance
      const userRows = await tx`
        SELECT withdrawal_wallet FROM users WHERE telegram_id = ${telegramId} FOR UPDATE
      `;
      if (userRows.length === 0) {
        return { status: 400, body: { error: 'USER_NOT_FOUND', message: 'User does not exist' } };
      }

      const walletBalance = parseFloat(userRows[0].withdrawal_wallet);
      if (walletBalance < amount) {
        return { status: 400, body: { error: 'INSUFFICIENT_WALLET', message: 'Insufficient Withdrawal Wallet' } };
      }

      // Insert withdrawal request
      await tx`
        INSERT INTO withdrawals_request
          (telegram_id, bank, account_holder_name, account_num, amount, status, text_status, created_at)
        VALUES
          (${telegramId}, ${bank}, ${trimmedName}, ${trimmedAccount}, ${amount}, 'pending', 'pending', NOW())
      `;

      // Debit wallet
      const updateRows = await tx`
        UPDATE users
        SET withdrawal_wallet = withdrawal_wallet - ${amount}
        WHERE telegram_id = ${telegramId} AND withdrawal_wallet >= ${amount}
        RETURNING telegram_id
      `;

      if (updateRows.length === 0) {
        return { status: 400, body: { error: 'INSUFFICIENT_WALLET', message: 'Insufficient Withdrawal Wallet' } };
      }

      return { status: 200, body: { success: true } };
    });

    res.status(result.status).json(result.body);

    // 5. Post-commit: fire webhook + send Telegram message (fire-and-forget)
    if (result.status === 200) {
      // Webhook wake signal
      if (config.withdrawWebhookUrl) {
        fetch(config.withdrawWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'pass-key': config.withdrawWebhookPassKey,
          },
          body: JSON.stringify({ event: 'new' }),
        }).catch((e) => console.error('[withdraw] webhook failed:', e));
      }

      // Telegram message
      bot.telegram.sendMessage(
        telegramId,
        'የገንዘብ ማውጣት ሂደትዎ በመከናወን ላይ ነው! ⏳\n\nይህ ጥቂት ደቂቃዎችን ሊወስድ ስለሚችል በትዕግስት ይጠብቁን። 🔄✨'
      ).catch((e) => console.error('[withdraw] telegram msg failed:', e));
    }
  } catch (err) {
    console.error('[requestWithdrawal]', err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}