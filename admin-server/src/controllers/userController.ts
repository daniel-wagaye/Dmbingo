import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { config } from '../config';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;

const parseDateRange = (startDate?: string, endDate?: string) => {
  if (!startDate && !endDate) {
    return null;
  }
  if (!startDate || !endDate) {
    return { error: 'missing_date_range' as const };
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'invalid_date' as const };
  }
  if (end.getTime() < start.getTime()) {
    return { error: 'invalid_range' as const };
  }
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
};

const sendTelegramCreditNotice = async (telegramId: number, amount: number) => {
  if (!config.telegramBotToken) {
    return;
  }
  const message = `Congratulation\nYou just get ${amount} Birr to Your wallet.`;
  await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramId,
      text: message,
    }),
  }).catch(() => null);
};

export const listUsers = async (req: Request, res: Response) => {
  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const search = (req.query.search as string | undefined)?.trim();
  const sortBy = (req.query.sortBy as string | undefined)?.trim();
  const sortOrder = ((req.query.sortOrder as string | undefined) ?? 'desc').toLowerCase();
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;

  const allowedSort: Record<string, string> = {
    telegram_id: 'telegram_id',
    first_name: 'first_name',
    phone_number: 'phone_number',
    username: 'username',
    withdrawal_wallet: 'withdrawal_wallet',
    non_withdrawal_wallet: 'non_withdrawal_wallet',
    referral_count: 'referral_count',
    created_at: 'created_at',
  };
  const sortColumn = allowedSort[sortBy ?? ''] ?? 'created_at';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const values: Array<string | number | Date> = [];
  const where: string[] = [];

  if (search) {
    values.push(`%${search}%`);
    const index = values.length;
    where.push(
      `(CAST(telegram_id AS TEXT) ILIKE $${index} OR phone_number ILIKE $${index} OR username ILIKE $${index} OR first_name ILIKE $${index})`
    );
  }

  const range = parseDateRange(startDate, endDate);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }
  if (range) {
    values.push(range.start);
    values.push(range.endExclusive);
    const startIndex = values.length - 1;
    const endIndex = values.length;
    where.push(`created_at >= $${startIndex} AND created_at < $${endIndex}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * PAGE_SIZE;

  const countQuery = `SELECT COUNT(*)::int AS total FROM users ${whereSql}`;
  const countResult = await pool.query(countQuery, values);
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const dataValues = [...values, PAGE_SIZE, offset];
  const dataQuery = `
    SELECT
      telegram_id,
      first_name,
      phone_number,
      username,
      withdrawal_wallet,
      non_withdrawal_wallet,
      referral_count,
      created_at
    FROM users
    ${whereSql}
    ORDER BY ${sortColumn} ${order}
    LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}
  `;
  const dataResult = await pool.query(dataQuery, dataValues);

  return res.json({
    data: dataResult.rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const creditUser = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { telegramId, amount, wallet, actionPassword } = req.body as {
    telegramId?: number;
    amount?: number;
    wallet?: 'withdrawal' | 'non_withdrawal';
    actionPassword?: string;
  };

  if (!telegramId || !amount || amount <= 0 || !wallet || !actionPassword) {
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
    const updateQuery =
      wallet === 'withdrawal'
        ? `UPDATE users SET withdrawal_wallet = withdrawal_wallet + $1 WHERE telegram_id = $2 RETURNING telegram_id, withdrawal_wallet, non_withdrawal_wallet`
        : `UPDATE users SET non_withdrawal_wallet = non_withdrawal_wallet + $1 WHERE telegram_id = $2 RETURNING telegram_id, withdrawal_wallet, non_withdrawal_wallet`;
    const updateResult = await client.query(updateQuery, [amount, telegramId]);
    if (!updateResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'user_not_found' });
    }

    await client.query(
      `INSERT INTO admin_credit_history (telegram_id, amount, credited_wallet, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [telegramId, amount, wallet]
    );

    const details = JSON.stringify({ amount, wallet, telegramId });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'credit_user', $2, 'user', $3::jsonb, $4, $5)`,
      [admin.adminId, telegramId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');

    await sendTelegramCreditNotice(telegramId, amount);

    return res.json({
      status: 'ok',
      user: updateResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};
