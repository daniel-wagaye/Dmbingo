import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { config } from '../config';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;
const JSON_MAX_LENGTH = 300;
const REQUIRED_KEYS = ['sender-name', 'amount-pattern', 'transaction-id-pattern'] as const;

type ParsedRegexJson = Record<string, string>;

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

const parseRegexJson = (regexJson: string) => {
  if (regexJson.length > JSON_MAX_LENGTH) {
    return { error: 'regex_json_too_long' as const };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(regexJson);
  } catch {
    return { error: 'invalid_json' as const };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'invalid_json' as const };
  }
  const configObj = parsed as ParsedRegexJson;
  for (const key of REQUIRED_KEYS) {
    if (!configObj[key] || typeof configObj[key] !== 'string' || !configObj[key].trim()) {
      return { error: 'missing_required_keys' as const };
    }
  }
  try {
    new RegExp(configObj['amount-pattern'], 'iu');
    new RegExp(configObj['transaction-id-pattern'], 'iu');
  } catch {
    return { error: 'invalid_regex' as const };
  }
  return { parsed: configObj };
};

const triggerRegexWakeup = async () => {
  if (!config.regexWakeupUrl) {
    return { ok: false, status: 500, error: 'missing_regex_wakeup_url' as const };
  }
  const response = await fetch(config.regexWakeupUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).catch(() => null);
  if (!response) {
    return { ok: false, status: 502, error: 'wakeup_failed' as const };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: 'wakeup_failed' as const };
  }
  return { ok: true, status: response.status };
};

export const listRegexConfigs = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();

  const whereClause = search ? `WHERE bank_name ILIKE $1` : '';
  const searchParam = search ? `%${search}%` : null;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM regex_config ${whereClause}`,
    search ? [searchParam] : []
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const dataResult = await pool.query(
    `
      SELECT id, bank_name, regex_json, is_active, created_at, updated_at
      FROM regex_config
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

export const createRegexConfig = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const { bank_name, regex_json, is_active, action_password } = req.body as {
    bank_name?: string;
    regex_json?: string;
    is_active?: boolean;
    action_password?: string;
  };

  if (!bank_name || !regex_json || typeof is_active !== 'boolean' || !action_password) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (bank_name.trim().length > 64) {
    return res.status(400).json({ error: 'invalid_bank_name' });
  }

  const parsedResult = parseRegexJson(regex_json);
  if ('error' in parsedResult) {
    return res.status(400).json({ error: parsedResult.error });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, action_password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertResult = await client.query(
      `
        INSERT INTO regex_config (bank_name, regex_json, is_active, created_at, updated_at)
        VALUES ($1, $2::jsonb, $3, NOW(), NOW())
        RETURNING id, bank_name, regex_json, is_active, created_at, updated_at
      `,
      [bank_name.trim(), JSON.stringify(parsedResult.parsed), is_active]
    );

    const details = JSON.stringify({
      bank_name: bank_name.trim(),
      regex_json: parsedResult.parsed,
      is_active,
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'create_regex', $2, 'regex', $3::jsonb, $4, $5)`,
      [admin.adminId, insertResult.rows[0].id, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    const wakeup = await triggerRegexWakeup();
    return res.status(201).json({ status: 'ok', regex: insertResult.rows[0], wakeup });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && 'code' in error) {
      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'bank_name_exists' });
      }
    }
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const updateRegexConfig = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const regexId = Number.parseInt(req.params.id, 10);
  if (!regexId) {
    return res.status(400).json({ error: 'invalid_regex_id' });
  }

  const { bank_name, regex_json, is_active, action_password } = req.body as {
    bank_name?: string;
    regex_json?: string;
    is_active?: boolean;
    action_password?: string;
  };

  if (!bank_name || !regex_json || typeof is_active !== 'boolean' || !action_password) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (bank_name.trim().length > 64) {
    return res.status(400).json({ error: 'invalid_bank_name' });
  }

  const parsedResult = parseRegexJson(regex_json);
  if ('error' in parsedResult) {
    return res.status(400).json({ error: parsedResult.error });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, action_password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT id, bank_name, regex_json, is_active FROM regex_config WHERE id = $1 FOR UPDATE`,
      [regexId]
    );
    if (!existingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'regex_not_found' });
    }

    const updateResult = await client.query(
      `
        UPDATE regex_config
        SET bank_name = $1, regex_json = $2::jsonb, is_active = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING id, bank_name, regex_json, is_active, created_at, updated_at
      `,
      [bank_name.trim(), JSON.stringify(parsedResult.parsed), is_active, regexId]
    );

    const details = JSON.stringify({
      before: existingResult.rows[0],
      after: updateResult.rows[0],
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'edit_regex', $2, 'regex', $3::jsonb, $4, $5)`,
      [admin.adminId, regexId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    const wakeup = await triggerRegexWakeup();
    return res.json({ status: 'ok', regex: updateResult.rows[0], wakeup });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && 'code' in error) {
      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'bank_name_exists' });
      }
    }
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const deleteRegexConfig = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const regexId = Number.parseInt(req.params.id, 10);
  if (!regexId) {
    return res.status(400).json({ error: 'invalid_regex_id' });
  }

  const { action_password } = req.body as { action_password?: string };
  if (!action_password) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, action_password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT id, bank_name FROM regex_config WHERE id = $1 FOR UPDATE`,
      [regexId]
    );
    if (!existingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'regex_not_found' });
    }

    await client.query(`DELETE FROM regex_config WHERE id = $1`, [regexId]);

    const details = JSON.stringify({
      bank_name: existingResult.rows[0].bank_name,
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'delete_regex', $2, 'regex', $3::jsonb, $4, $5)`,
      [admin.adminId, regexId, details, req.ip ?? null, req.get('user-agent') ?? null]
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

export const wakeupRegexAcceptor = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const result = await triggerRegexWakeup();
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json({ status: 'ok' });
};
