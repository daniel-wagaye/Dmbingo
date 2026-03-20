import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { config } from '../config';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;

const sendTelegramMessage = async (telegramId: number, message: string) => {
  if (!config.telegramBotToken) {
    return;
  }
  await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramId,
      text: message,
    }),
  }).catch(() => null);
};

const getAdminInfo = async (adminId: number) => {
  const adminResult = await pool.query(
    `SELECT admin_id, first_name, action_password_hash FROM admins WHERE admin_id = $1`,
    [adminId]
  );
  return adminResult.rows[0] as
    | { admin_id: number; first_name: string | null; action_password_hash: string }
    | undefined;
};

export const listWithdrawals = async (req: Request, res: Response) => {
  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const statusParam = (req.query.status as string | undefined)?.toLowerCase();
  const isPending = statusParam === 'pending';
  const whereClause = isPending
    ? `WHERE w.status = 'pending'`
    : `WHERE w.status IN ('approved', 'declined')`;

  const offset = (page - 1) * PAGE_SIZE;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM withdrawals_request w ${whereClause}`
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const dataResult = await pool.query(
    `
      SELECT
        w.withdrawal_id,
        w.telegram_id,
        u.first_name,
        w.amount,
        w.bank,
        w.account_holder_name AS account_holder,
        w.account_num,
        w.status,
        w.created_at,
        w.processed_at
      FROM withdrawals_request w
      LEFT JOIN users u ON u.telegram_id = w.telegram_id
      ${whereClause}
      ORDER BY w.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    [PAGE_SIZE, offset]
  );

  return res.json({
    data: dataResult.rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const approveWithdrawal = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { withdrawalId, actionPassword, adminTxNumber } = req.body as {
    withdrawalId?: number;
    actionPassword?: string;
    adminTxNumber?: string;
  };

  if (!withdrawalId || !actionPassword || !adminTxNumber?.trim()) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (adminTxNumber.trim().length < 9 || adminTxNumber.trim().length > 21) {
    return res.status(400).json({ error: 'invalid_tx_number' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateResult = await client.query(
      `UPDATE withdrawals_request
       SET status = 'approved',
           admin_tx_number = $1,
           admin_first_name = $2,
           processed_at = NOW()
       WHERE withdrawal_id = $3 AND status = 'pending'
       RETURNING telegram_id, amount, bank`,
      [adminTxNumber.trim(), adminInfo.first_name ?? '', withdrawalId]
    );
    if (!updateResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'withdrawal_not_found' });
    }

    const row = updateResult.rows[0] as { telegram_id: number; amount: string; bank: string };
    const details = JSON.stringify({ adminTxNumber: adminTxNumber.trim(), withdrawalId });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'approve_withdrawal', $2, 'withdrawal', $3::jsonb, $4, $5)`,
      [admin.adminId, withdrawalId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');

    await sendTelegramMessage(
      row.telegram_id,
      `✅ Your withdrawal of ${row.amount} ETB has been successfully credited to your ${row.bank} account.`
    );

    return res.json({ status: 'ok' });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const declineWithdrawal = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { withdrawalId, actionPassword, reason } = req.body as {
    withdrawalId?: number;
    actionPassword?: string;
    reason?: 'incorrect' | 'bank';
  };

  if (!withdrawalId || !actionPassword || !reason) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestResult = await client.query(
      `SELECT telegram_id, amount FROM withdrawals_request WHERE withdrawal_id = $1 AND status = 'pending'`,
      [withdrawalId]
    );
    if (!requestResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'withdrawal_not_found' });
    }

    const row = requestResult.rows[0] as { telegram_id: number; amount: string };
    await client.query(
      `UPDATE users SET withdrawal_wallet = withdrawal_wallet + $1 WHERE telegram_id = $2`,
      [row.amount, row.telegram_id]
    );

    await client.query(
      `UPDATE withdrawals_request
       SET status = 'declined',
           declined_reason = $1,
           admin_first_name = $2,
           processed_at = NOW()
       WHERE withdrawal_id = $3`,
      [reason, adminInfo.first_name ?? '', withdrawalId]
    );

    const details = JSON.stringify({ reason, withdrawalId });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'decline_withdrawal', $2, 'withdrawal', $3::jsonb, $4, $5)`,
      [admin.adminId, withdrawalId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');

    const message =
      reason === 'bank'
        ? '🙏 Please choose another bank.\nSorry for the inconvenience!.'
        : '❌ Your request is Canceled due to incorrect information.\nRequest another withdrawal with correct information';
    await sendTelegramMessage(row.telegram_id, message);

    return res.json({ status: 'ok' });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};
