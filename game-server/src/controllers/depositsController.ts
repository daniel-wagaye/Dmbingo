import { Request, Response } from 'express';
import { config } from '../config';
import { isAllowed } from '../middlewares/rateLimitPerUser';
import { sql } from '../db/drizzle';

export async function validateDeposit(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;

    if (!isAllowed('deposit', telegramId, config.depositRateLimitWindowMs, config.depositRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Try again later.' });
      return;
    }

    const txnReference = req.body?.txn_reference;
    if (!txnReference || typeof txnReference !== 'string') {
      res.status(400).json({ error: 'INVALID_TXN_FORMAT', message: 'Transaction reference is required' });
      return;
    }

    const trimmed = txnReference.trim();
    if (trimmed.length < 8 || trimmed.length > 40) {
      res.status(400).json({ error: 'INVALID_TXN_FORMAT', message: 'Invalid transaction reference' });
      return;
    }

    const result = await sql.begin(async (tx: any) => {
      // 1. Find deposit row with lock
      const depositRows = await tx`
        SELECT * FROM deposits WHERE txn_reference = ${trimmed} FOR UPDATE
      `;

      if (depositRows.length === 0) {
        return { status: 404, body: { error: 'DEPOSIT_NOT_FOUND', message: 'The Deposit Does Not Exist' } };
      }

      const deposit = depositRows[0];

      // 2. Check status
      if (deposit.status === 'approved') {
        return { status: 409, body: { error: 'ALREADY_PROCESSED', message: 'Deposit already processed.' } };
      }

      if (deposit.status === 'rejected') {
        return { status: 409, body: { error: 'REJECTED', message: 'Deposit is Rejected!\nplease reach out to our customers if you think this is a mistake' } };
      }

      // 3. status === 'pending' → credit user wallet
      const userRows = await tx`
        UPDATE users
        SET non_withdrawal_wallet = non_withdrawal_wallet + ${deposit.amount}
        WHERE telegram_id = ${telegramId}
        RETURNING telegram_id
      `;

      if (userRows.length === 0) {
        return { status: 400, body: { error: 'USER_NOT_FOUND', message: 'User does not exist' } };
      }

      // 4. Mark deposit as approved
      await tx`
        UPDATE deposits
        SET status = 'approved',
            telegram_id = ${telegramId},
            processed_at = NOW()
        WHERE deposit_id = ${deposit.deposit_id}
      `;

      return {
        status: 200,
        body: {
          success: true,
          amount: parseFloat(deposit.amount),
          message: `Your deposit is successfully APPROVED.\nYour wallet is credited with:\n${deposit.amount} ETB`,
        },
      };
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[validateDeposit]', err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  }
}

export async function getBankData(_req: Request, res: Response): Promise<void> {
  try {
    const rows = await sql`SELECT bank_name, account_number, account_holder_name FROM bank_data ORDER BY id`;
    res.status(200).json({ success: true, banks: rows });
  } catch (err) {
    console.error('[getBankData]', err);
    res.status(500).json({ error: 'INTERNAL' });
  }
}