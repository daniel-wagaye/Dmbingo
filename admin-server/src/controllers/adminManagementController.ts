import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;
const USERNAME_REGEX = /^[A-Za-z0-9_-]{3,32}$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

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

const isValidUsername = (value: string) => USERNAME_REGEX.test(value);
const isValidPassword = (value: string) => PASSWORD_REGEX.test(value);

export const listAdmins = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();
  const sortOrder = ((req.query.sortOrder as string | undefined) ?? 'desc').toLowerCase();
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const values: Array<string | number> = [];
  const where: string[] = [];

  if (search) {
    values.push(`%${search}%`);
    const index = values.length;
    where.push(
      `(username ILIKE $${index} OR first_name ILIKE $${index} OR last_name ILIKE $${index})`
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM admins ${whereSql}`,
    values
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  values.push(PAGE_SIZE, offset);
  const dataResult = await pool.query(
    `
      SELECT admin_id, role, first_name, last_name, username, created_at, is_active
      FROM admins
      ${whereSql}
      ORDER BY created_at ${order}
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values
  );

  return res.json({
    data: dataResult.rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const createAdmin = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const {
    role,
    username,
    firstName,
    lastName,
    loginPassword,
    actionPassword,
    superAdminActionPassword,
  } = req.body as {
    role?: 'withdrawal_admin';
    username?: string;
    firstName?: string;
    lastName?: string;
    loginPassword?: string;
    actionPassword?: string;
    superAdminActionPassword?: string;
  };

  if (
    !role ||
    !username ||
    !firstName ||
    !loginPassword ||
    !actionPassword ||
    !superAdminActionPassword
  ) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  if (role !== 'withdrawal_admin') {
    return res.status(400).json({ error: 'invalid_role' });
  }

  const trimmedUsername = username.trim();
  if (!isValidUsername(trimmedUsername)) {
    return res.status(400).json({ error: 'invalid_username' });
  }

  if (!isValidPassword(loginPassword) || !isValidPassword(actionPassword)) {
    return res.status(400).json({ error: 'invalid_password' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, superAdminActionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const loginHash = await argon2.hash(loginPassword);
  const actionHash = await argon2.hash(actionPassword);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertResult = await client.query(
      `
        INSERT INTO admins (
          username,
          login_password_hash,
          action_password_hash,
          role,
          first_name,
          last_name,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
        RETURNING admin_id, role, first_name, last_name, username, created_at, is_active
      `,
      [trimmedUsername, loginHash, actionHash, role, firstName.trim(), lastName?.trim() ?? null]
    );

    const details = JSON.stringify({
      role,
      username: trimmedUsername,
      first_name: firstName.trim(),
      last_name: lastName?.trim() ?? null,
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'create_admin', $2, 'admin', $3::jsonb, $4, $5)`,
      [
        admin.adminId,
        insertResult.rows[0].admin_id,
        details,
        req.ip ?? null,
        req.get('user-agent') ?? null,
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({ status: 'ok', admin: insertResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && 'code' in error) {
      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'username_exists' });
      }
    }
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const updateAdmin = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const adminId = Number.parseInt(req.params.id, 10);
  if (!adminId) {
    return res.status(400).json({ error: 'invalid_admin_id' });
  }

  const { editMode, username, loginPassword, actionPassword, superAdminActionPassword } =
    req.body as {
      editMode?: 'username' | 'login_password' | 'action_password' | 'all';
      username?: string;
      loginPassword?: string;
      actionPassword?: string;
      superAdminActionPassword?: string;
    };

  if (!editMode || !superAdminActionPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, superAdminActionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const fields: string[] = [];
  const params: Array<string | number> = [];

  if (editMode === 'username' || editMode === 'all') {
    if (!username) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const trimmedUsername = username.trim();
    if (!isValidUsername(trimmedUsername)) {
      return res.status(400).json({ error: 'invalid_username' });
    }
    params.push(trimmedUsername);
    fields.push(`username = $${params.length}`);
  }

  if (editMode === 'login_password' || editMode === 'all') {
    if (!loginPassword || !isValidPassword(loginPassword)) {
      return res.status(400).json({ error: 'invalid_password' });
    }
    const loginHash = await argon2.hash(loginPassword);
    params.push(loginHash);
    fields.push(`login_password_hash = $${params.length}`);
  }

  if (editMode === 'action_password' || editMode === 'all') {
    if (!actionPassword || !isValidPassword(actionPassword)) {
      return res.status(400).json({ error: 'invalid_password' });
    }
    const actionHash = await argon2.hash(actionPassword);
    params.push(actionHash);
    fields.push(`action_password_hash = $${params.length}`);
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT admin_id, role, first_name, last_name, username, is_active FROM admins WHERE admin_id = $1 FOR UPDATE`,
      [adminId]
    );
    if (!existingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'admin_not_found' });
    }

    params.push(adminId);
    const updateResult = await client.query(
      `
        UPDATE admins
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE admin_id = $${params.length}
        RETURNING admin_id, role, first_name, last_name, username, created_at, is_active
      `,
      params
    );

    const details = JSON.stringify({
      edit_mode: editMode,
      before: existingResult.rows[0],
      after: updateResult.rows[0],
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'edit_admin', $2, 'admin', $3::jsonb, $4, $5)`,
      [admin.adminId, adminId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.json({ status: 'ok', admin: updateResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && 'code' in error) {
      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'username_exists' });
      }
    }
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const updateAdminStatus = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const adminId = Number.parseInt(req.params.id, 10);
  if (!adminId) {
    return res.status(400).json({ error: 'invalid_admin_id' });
  }

  const { isActive, actionPassword } = req.body as {
    isActive?: boolean;
    actionPassword?: string;
  };

  if (isActive === undefined || !actionPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  if (admin.adminId === adminId && !isActive) {
    return res.status(400).json({ error: 'cannot_deactivate_self' });
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
      `SELECT admin_id, role, first_name, last_name, username, is_active FROM admins WHERE admin_id = $1 FOR UPDATE`,
      [adminId]
    );
    if (!existingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'admin_not_found' });
    }

    const updateResult = await client.query(
      `
        UPDATE admins
        SET is_active = $1, updated_at = NOW()
        WHERE admin_id = $2
        RETURNING admin_id, role, first_name, last_name, username, created_at, is_active
      `,
      [isActive, adminId]
    );

    const details = JSON.stringify({ is_active: isActive });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'set_admin_status', $2, 'admin', $3::jsonb, $4, $5)`,
      [admin.adminId, adminId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.json({ status: 'ok', admin: updateResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};
