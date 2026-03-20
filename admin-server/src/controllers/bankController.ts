import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;
const ACCOUNT_NUMBER_REGEX = /^\d{5,20}$/;

const ensureSuperAdmin = (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  if (admin.role !== 'super_admin') {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return admin;
};

const getAdminInfo = async (adminId: number) => {
  const adminResult = await pool.query(
    `SELECT admin_id, action_password_hash FROM admins WHERE admin_id = $1`,
    [adminId]
  );
  return adminResult.rows[0] as { admin_id: number; action_password_hash: string } | undefined;
};

const isValidAccountNumber = (value: string) => ACCOUNT_NUMBER_REGEX.test(value);

const validateBankFields = (bankName: string, accountNumber: string, accountHolderName: string) => {
  if (!bankName.trim() || !accountHolderName.trim()) {
    return 'missing_fields' as const;
  }
  if (bankName.trim().length > 64 || accountHolderName.trim().length > 64) {
    return 'invalid_length' as const;
  }
  if (!isValidAccountNumber(accountNumber.trim())) {
    return 'invalid_account_number' as const;
  }
  return null;
};

export const listBanks = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();

  const whereClause = search ? `WHERE bank_name ILIKE $1 OR account_number ILIKE $1` : '';
  const searchParam = search ? `%${search}%` : null;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM bank_data ${whereClause}`,
    search ? [searchParam] : []
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const dataResult = await pool.query(
    `
      SELECT id, bank_name, account_number, account_holder_name, created_at, updated_at
      FROM bank_data
      ${whereClause}
      ORDER BY id DESC
      LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}
    `,
    search ? [searchParam, PAGE_SIZE, offset] : [PAGE_SIZE, offset]
  );

  return res.json({
    data: dataResult.rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const createBank = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const { bankName, accountNumber, accountHolderName, actionPassword } = req.body as {
    bankName?: string;
    accountNumber?: string;
    accountHolderName?: string;
    actionPassword?: string;
  };

  if (!bankName || !accountNumber || !accountHolderName || !actionPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const validation = validateBankFields(bankName, accountNumber, accountHolderName);
  if (validation) {
    return res.status(400).json({ error: validation });
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
    await client.query('LOCK TABLE bank_data IN EXCLUSIVE MODE');
    const maxResult = await client.query(`SELECT COALESCE(MAX(id), 0) AS max_id FROM bank_data`);
    const maxId = Number(maxResult.rows[0]?.max_id ?? 0);
    const nextId = maxId + 1;

    const insertResult = await client.query(
      `
        INSERT INTO bank_data (id, bank_name, account_number, account_holder_name, created_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id, bank_name, account_number, account_holder_name, created_at, updated_at
      `,
      [nextId, bankName.trim(), accountNumber.trim(), accountHolderName.trim()]
    );

    const details = JSON.stringify({
      bank_name: bankName.trim(),
      account_number: accountNumber.trim(),
      account_holder: accountHolderName.trim(),
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'create_bank', $2, 'bank', $3::jsonb, $4, $5)`,
      [admin.adminId, nextId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.status(201).json({ status: 'ok', bank: insertResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const updateBank = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const bankId = Number.parseInt(req.params.id, 10);
  if (!bankId) {
    return res.status(400).json({ error: 'invalid_bank_id' });
  }

  const { bankName, accountNumber, accountHolderName, actionPassword } = req.body as {
    bankName?: string;
    accountNumber?: string;
    accountHolderName?: string;
    actionPassword?: string;
  };

  if (!bankName || !accountNumber || !accountHolderName || !actionPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const validation = validateBankFields(bankName, accountNumber, accountHolderName);
  if (validation) {
    return res.status(400).json({ error: validation });
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
    const existingResult = await client.query(
      `SELECT id, bank_name, account_number, account_holder_name FROM bank_data WHERE id = $1 FOR UPDATE`,
      [bankId]
    );
    if (!existingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'bank_not_found' });
    }

    const before = existingResult.rows[0];
    const updateResult = await client.query(
      `
        UPDATE bank_data
        SET bank_name = $1, account_number = $2, account_holder_name = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING id, bank_name, account_number, account_holder_name, created_at, updated_at
      `,
      [bankName.trim(), accountNumber.trim(), accountHolderName.trim(), bankId]
    );

    const details = JSON.stringify({
      before,
      after: updateResult.rows[0],
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'edit_bank', $2, 'bank', $3::jsonb, $4, $5)`,
      [admin.adminId, bankId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.json({ status: 'ok', bank: updateResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const deleteBank = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const bankId = Number.parseInt(req.params.id, 10);
  if (!bankId) {
    return res.status(400).json({ error: 'invalid_bank_id' });
  }

  const { actionPassword } = req.body as { actionPassword?: string };
  if (!actionPassword) {
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
    const existingResult = await client.query(
      `SELECT id, bank_name, account_number, account_holder_name FROM bank_data WHERE id = $1 FOR UPDATE`,
      [bankId]
    );
    if (!existingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'bank_not_found' });
    }

    await client.query(`DELETE FROM bank_data WHERE id = $1`, [bankId]);

    const details = JSON.stringify({
      bank_name: existingResult.rows[0].bank_name,
      account_number: existingResult.rows[0].account_number,
      account_holder: existingResult.rows[0].account_holder_name,
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'delete_bank', $2, 'bank', $3::jsonb, $4, $5)`,
      [admin.adminId, bankId, details, req.ip ?? null, req.get('user-agent') ?? null]
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
