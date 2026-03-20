import type { Request, Response } from 'express';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;

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

const maskPhone = (phone: string | null) => {
  if (!phone) return null;
  const normalized = phone.replace(/\s+/g, '');
  const last4 = normalized.slice(-4);
  const masked = '*'.repeat(Math.max(normalized.length - 4, 0));
  return `${masked}${last4}`;
};

const toCsvValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const listTransferHistory = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();
  const wallet = (req.query.wallet as string | undefined)?.trim();
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(
      `(CAST(t.sender_id AS TEXT) ILIKE $${params.length} OR CAST(t.receiver_id AS TEXT) ILIKE $${params.length} OR sender.phone_number ILIKE $${params.length} OR receiver.phone_number ILIKE $${params.length})`
    );
  }
  if (wallet) {
    params.push(wallet);
    clauses.push(`t.wallet = $${params.length}`);
  }
  if (range && 'start' in range) {
    params.push(range.start);
    clauses.push(`t.created_at >= $${params.length}`);
    params.push(range.end);
    clauses.push(`t.created_at <= $${params.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM transfer_history t
      LEFT JOIN users sender ON sender.telegram_id = t.sender_id
      LEFT JOIN users receiver ON receiver.telegram_id = t.receiver_id
      ${whereClause}
    `,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  params.push(PAGE_SIZE, offset);
  const dataResult = await pool.query(
    `
      SELECT
        t.transfer_id,
        t.sender_id,
        t.receiver_id,
        t.wallet,
        t.amount,
        t.commission,
        t.created_at,
        sender.phone_number AS sender_phone,
        receiver.phone_number AS receiver_phone
      FROM transfer_history t
      LEFT JOIN users sender ON sender.telegram_id = t.sender_id
      LEFT JOIN users receiver ON receiver.telegram_id = t.receiver_id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );

  const data = dataResult.rows.map((row) => ({
    ...row,
    sender_phone: maskPhone(row.sender_phone as string | null),
    receiver_phone: maskPhone(row.receiver_phone as string | null),
    total_amount: String(
      Number(row.amount ?? 0) + Number(row.commission ?? 0)
    ),
  }));

  return res.json({
    data,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const listReferralHistory = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();
  const rewarded = (req.query.rewarded as string | undefined)?.trim();
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date | boolean> = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(
      `(CAST(referrer_id AS TEXT) ILIKE $${params.length} OR CAST(referred_user_id AS TEXT) ILIKE $${params.length})`
    );
  }
  if (rewarded === 'true' || rewarded === 'false') {
    params.push(rewarded === 'true');
    clauses.push(`rewarded = $${params.length}`);
  }
  if (range && 'start' in range) {
    params.push(range.start);
    clauses.push(`created_at >= $${params.length}`);
    params.push(range.end);
    clauses.push(`created_at <= $${params.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM referrals_history ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  params.push(PAGE_SIZE, offset);
  const dataResult = await pool.query(
    `
      SELECT referral_id, referrer_id, referred_user_id, rewarded, rewarded_amount, created_at
      FROM referrals_history
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
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

export const listAdminCreditHistory = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();
  const actionType = (req.query.actionType as string | undefined)?.trim();
  const wallet = (req.query.wallet as string | undefined)?.trim();
  const minAmountRaw = req.query.minAmount as string | undefined;
  const maxAmountRaw = req.query.maxAmount as string | undefined;
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }
  if (actionType && actionType !== 'credit_user') {
    return res.status(400).json({ error: 'invalid_action_type' });
  }

  const minAmount = minAmountRaw ? Number(minAmountRaw) : undefined;
  const maxAmount = maxAmountRaw ? Number(maxAmountRaw) : undefined;
  if (minAmountRaw && Number.isNaN(minAmount)) {
    return res.status(400).json({ error: 'invalid_min_amount' });
  }
  if (maxAmountRaw && Number.isNaN(maxAmount)) {
    return res.status(400).json({ error: 'invalid_max_amount' });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`CAST(telegram_id AS TEXT) ILIKE $${params.length}`);
  }
  if (wallet) {
    params.push(wallet);
    clauses.push(`credited_wallet = $${params.length}`);
  }
  if (minAmount !== undefined) {
    params.push(minAmount);
    clauses.push(`amount >= $${params.length}`);
  }
  if (maxAmount !== undefined) {
    params.push(maxAmount);
    clauses.push(`amount <= $${params.length}`);
  }
  if (range && 'start' in range) {
    params.push(range.start);
    clauses.push(`created_at >= $${params.length}`);
    params.push(range.end);
    clauses.push(`created_at <= $${params.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM admin_credit_history ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  params.push(PAGE_SIZE, offset);
  const dataResult = await pool.query(
    `
      SELECT credit_id, amount, credited_wallet, telegram_id, created_at
      FROM admin_credit_history
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );

  const data = dataResult.rows.map((row) => ({
    ...row,
    action: 'credit_user',
  }));

  return res.json({
    data,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const exportAdminCreditHistoryCsv = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const search = (req.query.search as string | undefined)?.trim();
  const actionType = (req.query.actionType as string | undefined)?.trim();
  const wallet = (req.query.wallet as string | undefined)?.trim();
  const minAmountRaw = req.query.minAmount as string | undefined;
  const maxAmountRaw = req.query.maxAmount as string | undefined;
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (!range || 'error' in range) {
    return res.status(400).json({ error: range ? range.error : 'missing_date_range' });
  }
  if (actionType && actionType !== 'credit_user') {
    return res.status(400).json({ error: 'invalid_action_type' });
  }

  const minAmount = minAmountRaw ? Number(minAmountRaw) : undefined;
  const maxAmount = maxAmountRaw ? Number(maxAmountRaw) : undefined;
  if (minAmountRaw && Number.isNaN(minAmount)) {
    return res.status(400).json({ error: 'invalid_min_amount' });
  }
  if (maxAmountRaw && Number.isNaN(maxAmount)) {
    return res.status(400).json({ error: 'invalid_max_amount' });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`CAST(telegram_id AS TEXT) ILIKE $${params.length}`);
  }
  if (wallet) {
    params.push(wallet);
    clauses.push(`credited_wallet = $${params.length}`);
  }
  if (minAmount !== undefined) {
    params.push(minAmount);
    clauses.push(`amount >= $${params.length}`);
  }
  if (maxAmount !== undefined) {
    params.push(maxAmount);
    clauses.push(`amount <= $${params.length}`);
  }
  params.push(range.start);
  clauses.push(`created_at >= $${params.length}`);
  params.push(range.end);
  clauses.push(`created_at <= $${params.length}`);

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const dataResult = await pool.query(
    `
      SELECT credit_id, amount, credited_wallet, telegram_id, created_at
      FROM admin_credit_history
      ${whereClause}
      ORDER BY created_at DESC
    `,
    params
  );

  const header = ['credit_id', 'amount', 'action', 'credited_wallet', 'telegram_id', 'created_at'];
  const rows = dataResult.rows.map((row) => [
    row.credit_id,
    row.amount,
    'credit_user',
    row.credited_wallet,
    row.telegram_id,
    row.created_at,
  ]);

  const csv = [header, ...rows].map((line) => line.map(toCsvValue).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="admin_credit_history.csv"');
  return res.send(csv);
};

export const listAdminActions = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const search = (req.query.search as string | undefined)?.trim();
  const range = parseDateRange(req.query.startDate as string | undefined, req.query.endDate as string | undefined);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];

  if (search) {
    params.push(`%${search}%`);
    clauses.push(
      `(CAST(aa.action_id AS TEXT) ILIKE $${params.length} OR CAST(aa.admin_id AS TEXT) ILIKE $${params.length} OR a.username ILIKE $${params.length} OR aa.action ILIKE $${params.length} OR aa.target_type ILIKE $${params.length} OR CAST(aa.target_id AS TEXT) ILIKE $${params.length})`
    );
  }
  if (range && 'start' in range) {
    params.push(range.start);
    clauses.push(`aa.created_at >= $${params.length}`);
    params.push(range.end);
    clauses.push(`aa.created_at <= $${params.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM admin_actions aa
      LEFT JOIN admins a ON a.admin_id = aa.admin_id
      ${whereClause}
    `,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  params.push(PAGE_SIZE, offset);
  const dataResult = await pool.query(
    `
      SELECT
        aa.action_id,
        aa.admin_id,
        a.username AS admin_username,
        aa.action AS action_type,
        aa.target_type,
        aa.target_id,
        aa.details AS payload,
        aa.ip_address AS ip,
        aa.user_agent,
        aa.created_at
      FROM admin_actions aa
      LEFT JOIN admins a ON a.admin_id = aa.admin_id
      ${whereClause}
      ORDER BY aa.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
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
