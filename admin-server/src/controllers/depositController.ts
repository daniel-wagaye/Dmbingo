import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;

export const listDeposits = async (req: Request, res: Response) => {
  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM deposits`);
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const dataResult = await pool.query(
    `
      SELECT
        d.deposit_id,
        d.telegram_id,
        u.first_name,
        d.amount,
        d.bank,
        d.txn_reference,
        d.status,
        d.created_at,
        d.processed_at
      FROM deposits d
      LEFT JOIN users u ON u.telegram_id = d.telegram_id
      ORDER BY d.created_at DESC
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

export const rejectDeposit = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { depositId, actionPassword, reason } = req.body as {
    depositId?: number;
    actionPassword?: string;
    reason?: string;
  };

  if (!depositId || !actionPassword || !reason?.trim()) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const adminResult = await pool.query(
    `SELECT admin_id, action_password_hash FROM admins WHERE admin_id = $1`,
    [admin.adminId]
  );
  if (!adminResult.rows.length) {
    return res.status(404).json({ error: 'admin_not_found' });
  }

  const actionHash = adminResult.rows[0].action_password_hash as string;
  const passwordOk = await argon2.verify(actionHash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updateResult = await client.query(
      `UPDATE deposits SET status = 'rejected', processed_at = NOW() WHERE deposit_id = $1 RETURNING deposit_id`,
      [depositId]
    );
    if (!updateResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'deposit_not_found' });
    }

    const details = JSON.stringify({ reason, depositId });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'reject_deposit', $2, 'deposit', $3::jsonb, $4, $5)`,
      [admin.adminId, depositId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.json({ status: 'ok' });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const createDeposit = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) return res.status(401).json({ error: 'unauthorized' });
  if (admin.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });

  const { actionPassword, bank, amount, txnReference } = req.body as {
    actionPassword?: string;
    bank?: string;
    amount?: number;
    txnReference?: string;
  };

  if (!actionPassword || !bank?.trim() || !amount || !txnReference?.trim()) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (amount <= 0) return res.status(400).json({ error: 'invalid_amount' });

  const adminResult = await pool.query(
    `SELECT admin_id, action_password_hash FROM admins WHERE admin_id = $1`,
    [admin.adminId]
  );
  if (!adminResult.rows.length) return res.status(404).json({ error: 'admin_not_found' });

  const passwordOk = await argon2.verify(adminResult.rows[0].action_password_hash as string, actionPassword);
  if (!passwordOk) return res.status(401).json({ error: 'invalid_action_password' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO deposits (bank, amount, txn_reference, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING deposit_id`,
      [bank.trim(), amount, txnReference.trim().toUpperCase()]
    );
    const depositId = insertResult.rows[0]?.deposit_id;

    const details = JSON.stringify({ depositId, bank: bank.trim(), amount, txnReference: txnReference.trim() });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'create_deposit', $2, 'deposit', $3::jsonb, $4, $5)`,
      [admin.adminId, depositId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.json({ status: 'ok', depositId });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.constraint === 'deposits_txn_reference_key') {
      return res.status(409).json({ error: 'duplicate_txn_reference' });
    }
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Request failed' });
  } finally {
    client.release();
  }
};

export const approveDeposit = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { depositId, telegramId, actionPassword, reason } = req.body as {
    depositId?: number;
    telegramId?: number;
    actionPassword?: string;
    reason?: string;
  };

  if (!depositId || !telegramId || !actionPassword || !reason?.trim()) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const adminResult = await pool.query(
    `SELECT admin_id, action_password_hash FROM admins WHERE admin_id = $1`,
    [admin.adminId]
  );
  if (!adminResult.rows.length) {
    return res.status(404).json({ error: 'admin_not_found' });
  }

  const actionHash = adminResult.rows[0].action_password_hash as string;
  const passwordOk = await argon2.verify(actionHash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `SELECT telegram_id FROM users WHERE telegram_id = $1`,
      [telegramId]
    );
    if (!userResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'user_not_found' });
    }

    const depositResult = await client.query(
      `UPDATE deposits SET status = 'approved', telegram_id = $1, processed_at = NOW() WHERE deposit_id = $2 RETURNING amount`,
      [telegramId, depositId]
    );
    if (!depositResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'deposit_not_found' });
    }

    const amount = Number(depositResult.rows[0].amount ?? 0);
    await client.query(
      `UPDATE users SET non_withdrawal_wallet = non_withdrawal_wallet + $1 WHERE telegram_id = $2`,
      [amount, telegramId]
    );

    const details = JSON.stringify({ reason, depositId, telegramId, amount });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'approve_deposit', $2, 'deposit', $3::jsonb, $4, $5)`,
      [admin.adminId, depositId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.json({ status: 'ok' });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};
