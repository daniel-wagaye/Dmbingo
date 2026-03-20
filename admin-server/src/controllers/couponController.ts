import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;
const CODE_REGEX = /^[A-Za-z0-9_-]{1,20}$/;

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
    `SELECT admin_id, action_password_hash, username FROM admins WHERE admin_id = $1`,
    [adminId]
  );
  return adminResult.rows[0] as
    | { admin_id: number; action_password_hash: string; username: string | null }
    | undefined;
};

const parseDateRange = (startDate?: string, endDate?: string) => {
  if (!startDate && !endDate) {
    return null;
  }
  if (!startDate || !endDate) {
    return { error: 'missing_date_range' as const };
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'invalid_date' as const };
  }
  if (end.getTime() <= start.getTime()) {
    return { error: 'invalid_range' as const };
  }
  return { start, end };
};

const toCsvValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const listCoupons = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();
  const sortBy = (req.query.sortBy as string | undefined) ?? 'created_at';
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`c.coupon_code ILIKE $${params.length}`);
  }
  if (range && 'start' in range) {
    params.push(range.start);
    clauses.push(`c.starts_at >= $${params.length}`);
    params.push(range.end);
    clauses.push(`c.expires_at <= $${params.length}`);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderColumn = sortBy === 'expires_at' ? 'c.expires_at' : 'c.created_at';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM coupons c ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  params.push(PAGE_SIZE, offset);
  const limitIndex = params.length - 1;
  const dataResult = await pool.query(
    `
      SELECT
        c.coupon_id,
        c.coupon_code,
        c.coupon_prize,
        c.credit_wallet,
        c.max_uses_total,
        c.current_uses,
        c.starts_at,
        c.expires_at,
        c.status,
        c.created_at,
        a.username AS created_by
      FROM coupons c
      LEFT JOIN admins a ON a.admin_id = c.created_by_admin
      ${whereClause}
      ORDER BY ${orderColumn} DESC
      LIMIT $${limitIndex} OFFSET $${limitIndex + 1}
    `,
    params
  );

  const now = Date.now();
  const data = dataResult.rows.map((row) => {
    const expiresAt = new Date(row.expires_at as string).getTime();
    const derivedStatus =
      row.status === 'finished' ? 'finished' : expiresAt <= now ? 'expired' : 'active';
    return { ...row, status: derivedStatus };
  });

  return res.json({
    data,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const createCoupon = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const {
    coupon_code,
    coupon_prize,
    max_uses_total,
    starts_at,
    expires_at,
    credit_wallet,
    admin_password,
  } = req.body as {
    coupon_code?: string;
    coupon_prize?: number;
    max_uses_total?: number;
    starts_at?: string;
    expires_at?: string;
    credit_wallet?: 'withdrawal' | 'non_withdrawal';
    admin_password?: string;
  };

  if (
    !coupon_code ||
    coupon_prize === undefined ||
    max_uses_total === undefined ||
    !starts_at ||
    !expires_at ||
    !credit_wallet ||
    !admin_password
  ) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const trimmedCode = coupon_code.trim();
  if (!CODE_REGEX.test(trimmedCode)) {
    return res.status(400).json({ error: 'invalid_coupon_code' });
  }

  const prizeValue = Number(coupon_prize);
  if (!Number.isFinite(prizeValue) || prizeValue <= 0 || !/^\d+(\.\d{1,2})?$/.test(String(coupon_prize))) {
    return res.status(400).json({ error: 'invalid_coupon_prize' });
  }
  const maxUses = Number(max_uses_total);
  if (!Number.isInteger(maxUses) || maxUses < 1) {
    return res.status(400).json({ error: 'invalid_max_uses' });
  }
  if (credit_wallet !== 'withdrawal' && credit_wallet !== 'non_withdrawal') {
    return res.status(400).json({ error: 'invalid_credit_wallet' });
  }

  const startsAt = new Date(starts_at);
  const expiresAt = new Date(expires_at);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
    return res.status(400).json({ error: 'invalid_date' });
  }
  if (expiresAt.getTime() <= startsAt.getTime()) {
    return res.status(400).json({ error: 'invalid_range' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, admin_password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertResult = await client.query(
      `
        INSERT INTO coupons (
          coupon_code,
          coupon_prize,
          credit_wallet,
          max_uses_total,
          current_uses,
          starts_at,
          expires_at,
          status,
          created_by_admin,
          created_at
        )
        VALUES ($1, $2, $3, $4, 0, $5, $6, 'active', $7, NOW())
        RETURNING coupon_id, coupon_code, coupon_prize, credit_wallet, max_uses_total, current_uses, starts_at, expires_at, status, created_at
      `,
      [trimmedCode, prizeValue, credit_wallet, maxUses, startsAt, expiresAt, admin.adminId]
    );

    const details = JSON.stringify({
      coupon_code: trimmedCode,
      coupon_prize: prizeValue,
      credit_wallet,
      max_uses_total: maxUses,
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'create_coupon', $2, 'coupon', $3::jsonb, $4, $5)`,
      [admin.adminId, insertResult.rows[0].coupon_id, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.status(201).json({ status: 'ok', coupon: insertResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && 'code' in error) {
      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'coupon_code_exists' });
      }
    }
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const finishCoupon = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const couponId = Number.parseInt(req.params.id, 10);
  if (!couponId) {
    return res.status(400).json({ error: 'invalid_coupon_id' });
  }
  const { admin_password } = req.body as { admin_password?: string };
  if (!admin_password) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, admin_password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      `SELECT coupon_id, status FROM coupons WHERE coupon_id = $1 FOR UPDATE`,
      [couponId]
    );
    if (!existingResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'coupon_not_found' });
    }
    if (existingResult.rows[0].status === 'finished') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'already_finished' });
    }

    const updateResult = await client.query(
      `UPDATE coupons SET status = 'finished' WHERE coupon_id = $1 RETURNING coupon_id, status`,
      [couponId]
    );

    const details = JSON.stringify({
      before_status: existingResult.rows[0].status,
      after_status: updateResult.rows[0].status,
    });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'finish_coupon', $2, 'coupon', $3::jsonb, $4, $5)`,
      [admin.adminId, couponId, details, req.ip ?? null, req.get('user-agent') ?? null]
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

export const exportCouponsCsv = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const search = (req.query.search as string | undefined)?.trim();
  const sortBy = (req.query.sortBy as string | undefined) ?? 'created_at';
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`c.coupon_code ILIKE $${params.length}`);
  }
  if (range && 'start' in range) {
    params.push(range.start);
    clauses.push(`c.starts_at >= $${params.length}`);
    params.push(range.end);
    clauses.push(`c.expires_at <= $${params.length}`);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderColumn = sortBy === 'expires_at' ? 'c.expires_at' : 'c.created_at';

  const dataResult = await pool.query(
    `
      SELECT
        c.coupon_id,
        c.coupon_code,
        c.coupon_prize,
        c.credit_wallet,
        c.max_uses_total,
        c.current_uses,
        c.starts_at,
        c.expires_at,
        c.status,
        c.created_at,
        a.username AS created_by
      FROM coupons c
      LEFT JOIN admins a ON a.admin_id = c.created_by_admin
      ${whereClause}
      ORDER BY ${orderColumn} DESC
    `,
    params
  );

  const now = Date.now();
  const rows = dataResult.rows.map((row) => {
    const expiresAt = new Date(row.expires_at as string).getTime();
    const derivedStatus =
      row.status === 'finished' ? 'finished' : expiresAt <= now ? 'expired' : 'active';
    return { ...row, status: derivedStatus };
  });

  const header = [
    'Coupon ID',
    'Coupon Code',
    'Prize',
    'Credit Wallet',
    'Max Uses',
    'Current Uses',
    'Starts At',
    'Expires At',
    'Status',
    'Created By',
    'Created At',
  ];
  const csvLines = [
    header.map(toCsvValue).join(','),
    ...rows.map((row) =>
      [
        row.coupon_id,
        row.coupon_code,
        row.coupon_prize,
        row.credit_wallet,
        row.max_uses_total,
        row.current_uses,
        row.starts_at,
        row.expires_at,
        row.status,
        row.created_by ?? '',
        row.created_at,
      ]
        .map(toCsvValue)
        .join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="coupons.csv"');
  return res.send(csvLines.join('\n'));
};

export const listCouponHistory = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();
  const telegramId = (req.query.telegramId as string | undefined)?.trim();
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`c.coupon_code ILIKE $${params.length}`);
  }
  if (telegramId) {
    params.push(telegramId);
    clauses.push(`h.user_telegram_id::text ILIKE $${params.length}`);
  }
  if (range && 'start' in range) {
    params.push(range.start);
    clauses.push(`h.claimed_at >= $${params.length}`);
    params.push(range.end);
    clauses.push(`h.claimed_at <= $${params.length}`);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM coupon_history h
      LEFT JOIN coupons c ON c.coupon_id = h.coupon_id
      ${whereClause}
    `,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  params.push(PAGE_SIZE, offset);
  const limitIndex = params.length - 1;
  const dataResult = await pool.query(
    `
      SELECT
        h.claimed_id,
        h.coupon_id,
        c.coupon_code,
        h.user_telegram_id,
        h.claimed_at,
        h.credited_amount,
        h.credit_wallet,
        c.coupon_prize
      FROM coupon_history h
      LEFT JOIN coupons c ON c.coupon_id = h.coupon_id
      ${whereClause}
      ORDER BY h.claimed_at DESC
      LIMIT $${limitIndex} OFFSET $${limitIndex + 1}
    `,
    params
  );

  return res.json({
    data: dataResult.rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const exportCouponHistoryCsv = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const search = (req.query.search as string | undefined)?.trim();
  const telegramId = (req.query.telegramId as string | undefined)?.trim();
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`c.coupon_code ILIKE $${params.length}`);
  }
  if (telegramId) {
    params.push(telegramId);
    clauses.push(`h.user_telegram_id::text ILIKE $${params.length}`);
  }
  if (range && 'start' in range) {
    params.push(range.start);
    clauses.push(`h.claimed_at >= $${params.length}`);
    params.push(range.end);
    clauses.push(`h.claimed_at <= $${params.length}`);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const dataResult = await pool.query(
    `
      SELECT
        h.claimed_id,
        c.coupon_code,
        h.coupon_id,
        h.user_telegram_id,
        h.claimed_at,
        h.credited_amount,
        h.credit_wallet,
        c.coupon_prize
      FROM coupon_history h
      LEFT JOIN coupons c ON c.coupon_id = h.coupon_id
      ${whereClause}
      ORDER BY h.claimed_at DESC
    `,
    params
  );

  const header = [
    'Claimed ID',
    'Coupon Code',
    'Coupon ID',
    'User Telegram ID',
    'Claimed At',
    'Coupon Prize',
    'Credited Amount',
    'Credit Wallet',
  ];
  const csvLines = [
    header.map(toCsvValue).join(','),
    ...dataResult.rows.map((row) =>
      [
        row.claimed_id,
        row.coupon_code,
        row.coupon_id,
        row.user_telegram_id,
        row.claimed_at,
        row.coupon_prize,
        row.credited_amount,
        row.credit_wallet,
      ]
        .map(toCsvValue)
        .join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="coupon_history.csv"');
  return res.send(csvLines.join('\n'));
};
