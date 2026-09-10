import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { pool } from '../db/drizzle';
import {
  sendDirectUserMessage,
  sendUserTelegramText,
  TelegramDeliveryError,
} from '../services/telegramNotifier';

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

const sendTelegramCreditNotice = async (
  telegramId: number,
  amount: number,
  wallet: 'withdrawal' | 'non_withdrawal'
) => {
  const walletLabel = wallet === 'withdrawal' ? 'Withdrawal Wallet' : 'Non-Withdrawal Wallet';
  const message = `እንኳን ደስ ያለዎት! 🎁\nከአስተዳዳሪው የ${amount} ብር ወደ ${walletLabel} ገቢ ተደርጎልዎታል። 💰.`;
  await sendUserTelegramText(telegramId, message, {
    messageEffectId: '5046509860389126442',
  });
};

export const getUserByTelegramId = async (req: Request, res: Response) => {
  const telegramId = Number(req.params.telegramId);
  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    return res.status(400).json({ error: 'invalid_telegram_id' });
  }

  const result = await pool.query(
    `SELECT
       telegram_id,
       first_name,
       phone_number,
       username,
       withdrawal_wallet,
       non_withdrawal_wallet,
       referral_count,
       streak_count,
       last_play_date,
       last_referred_date,
       language,
       created_at
     FROM users
     WHERE telegram_id = $1`,
    [telegramId]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'user_not_found' });
  }

  return res.json(result.rows[0]);
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
    streak_count: 'streak_count',
    last_play_date: 'last_play_date',
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
      streak_count,
      last_play_date,
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

    await sendTelegramCreditNotice(telegramId, amount, wallet).catch((error) => {
      console.error('[credit] telegram msg failed:', error);
    });

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

const TEXT_ONLY_MAX = 4096;
const PHOTO_CAPTION_MAX = 1024;
const MAX_IMAGE_BYTES = 700 * 1024;

const decodeJpegBase64 = (raw: string): Buffer | null => {
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(',');
  const payload = trimmed.startsWith('data:') && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  if (!payload || payload.length > 1_200_000) {
    return null;
  }
  try {
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length < 3 || buffer.length > MAX_IMAGE_BYTES) {
      return null;
    }
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      return null;
    }
    return buffer;
  } catch {
    return null;
  }
};

export const sendUserMessage = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { telegramId, text, actionPassword, imageBase64 } = req.body as {
    telegramId?: number;
    text?: string;
    actionPassword?: string;
    imageBase64?: string;
  };

  const telegram = Number(telegramId);
  const messageText = typeof text === 'string' ? text.trim() : '';
  const hasImage = typeof imageBase64 === 'string' && imageBase64.trim().length > 0;

  if (!Number.isFinite(telegram) || telegram <= 0 || !actionPassword) {
    return res.status(400).json({ error: 'missing_fields', message: 'Missing required fields.' });
  }
  if (!messageText && !hasImage) {
    return res.status(400).json({
      error: 'empty_message',
      message: 'Enter a message or attach a photo.',
    });
  }

  const maxText = hasImage ? PHOTO_CAPTION_MAX : TEXT_ONLY_MAX;
  if (messageText.length > maxText) {
    return res.status(400).json({
      error: 'text_too_long',
      message: hasImage
        ? 'With a photo, the message can be at most 1024 characters.'
        : 'Message can be at most 4096 characters.',
    });
  }

  let imageJpeg: Buffer | undefined;
  if (hasImage) {
    const decoded = decodeJpegBase64(imageBase64!);
    if (!decoded) {
      return res.status(400).json({
        error: 'invalid_image',
        message: 'The photo is invalid or larger than 1 MB after compression.',
      });
    }
    imageJpeg = decoded;
  }

  const adminResult = await pool.query(
    `SELECT admin_id, action_password_hash FROM admins WHERE admin_id = $1`,
    [admin.adminId]
  );
  if (!adminResult.rows.length) {
    return res.status(404).json({ error: 'admin_not_found', message: 'Admin not found.' });
  }

  const actionHash = adminResult.rows[0].action_password_hash as string;
  const passwordOk = await argon2.verify(actionHash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password', message: 'Incorrect action password.' });
  }

  const userResult = await pool.query(`SELECT telegram_id FROM users WHERE telegram_id = $1`, [telegram]);
  if (!userResult.rows.length) {
    return res.status(404).json({ error: 'user_not_found', message: 'User not found.' });
  }

  try {
    await sendDirectUserMessage({
      telegramId: telegram,
      text: messageText || undefined,
      imageJpeg,
    });
  } catch (error) {
    if (error instanceof TelegramDeliveryError) {
      return res.status(400).json({ error: error.reason, message: error.message });
    }
    const fallback = error instanceof Error ? error.message : 'Message failed.';
    return res.status(500).json({ error: 'send_failed', message: fallback });
  }

  const details = JSON.stringify({
    telegramId: telegram,
    hasImage: Boolean(imageJpeg),
    textLength: messageText.length,
  });
  await pool.query(
    `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
     VALUES ($1, 'send_user_message', $2, 'user', $3::jsonb, $4, $5)`,
    [admin.adminId, telegram, details, req.ip ?? null, req.get('user-agent') ?? null]
  ).catch((error) => {
    console.error('[sendUserMessage] admin_actions insert failed:', error);
  });

  return res.json({ status: 'ok' });
};
