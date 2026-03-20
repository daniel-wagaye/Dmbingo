import argon2 from 'argon2';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { Resend } from 'resend';
import { config } from '../config';
import { pool } from '../db/drizzle';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };
type QueryClient = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
type AdminOtpRow = {
  id: number;
  otp_hash: string;
  expires_at: string;
  attempts: number;
  created_at: string;
};

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

const hashOtp = (otp: string) =>
  crypto.createHmac('sha256', config.otpSecret).update(otp).digest('hex');

const sendOtpEmail = async (to: string, otp: string, subject: string) => {
  if (!resend) {
    return;
  }
  await resend.emails.send({
    from: config.resendFrom,
    to,
    subject,
    html: `<p>Your verification code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
  });
};

const getAdminPayload = (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return admin;
};

const insertAdminAction = async (client: QueryClient, params: {
  adminId: number;
  action: string;
  targetId?: number | null;
  targetType?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  const detailsJson = JSON.stringify(params.details ?? {});
  await client.query(
    `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      params.adminId,
      params.action,
      params.targetId ?? null,
      params.targetType ?? null,
      detailsJson,
      params.ip ?? null,
      params.userAgent ?? null,
    ]
  );
};

const getActiveOtp = async (
  client: QueryClient,
  adminId: number,
  purpose: string
): Promise<AdminOtpRow | null> => {
  const result = await client.query(
    `SELECT * FROM admin_otps
     WHERE admin_id = $1 AND purpose = $2 AND is_active = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [adminId, purpose]
  );
  return (result.rows[0] as AdminOtpRow | undefined) ?? null;
};

const checkOtpResend = async (
  client: QueryClient,
  adminId: number,
  purposes: string[]
): Promise<
  | { status: 'ok' }
  | { status: 'cooldown'; nextAllowedAt: string }
  | { status: 'resend_limited' }
> => {
  const recentCount = await client.query(
    `SELECT COUNT(*) AS count
     FROM admin_otps
     WHERE admin_id = $1
       AND purpose = ANY($2)
       AND created_at > NOW() - INTERVAL '${config.otpResendLimitWindowHours} hours'`,
    [adminId, purposes]
  );
  const countRow = recentCount.rows[0] as { count?: string | number } | undefined;
  const count = Number(countRow?.count ?? 0);
  if (count >= config.otpResendLimitMax) {
    return { status: 'resend_limited' as const };
  }

  const latestOtp = await client.query(
    `SELECT created_at
     FROM admin_otps
     WHERE admin_id = $1
       AND purpose = ANY($2)
     ORDER BY created_at DESC
     LIMIT 1`,
    [adminId, purposes]
  );

  if (latestOtp.rows.length) {
    const latestRow = latestOtp.rows[0] as { created_at?: string } | undefined;
    const createdAtValue = latestRow?.created_at ?? '';
    const createdAt = new Date(createdAtValue);
    const nextAllowed = new Date(createdAt.getTime() + config.otpResendCooldownSeconds * 1000);
    if (Date.now() < nextAllowed.getTime()) {
      return { status: 'cooldown' as const, nextAllowedAt: nextAllowed.toISOString() };
    }
  }

  return { status: 'ok' as const };
};

const validateOtp = async (client: QueryClient, params: {
  adminId: number;
  purpose: string;
  otp: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<
  | { status: 'no_active_otp' }
  | { status: 'otp_expired' }
  | { status: 'too_many_attempts' }
  | { status: 'invalid_otp'; attemptsLeft: number }
  | { status: 'valid'; otpId: number }
> => {
  const otpRow = await getActiveOtp(client, params.adminId, params.purpose);
  if (!otpRow) {
    return { status: 'no_active_otp' as const };
  }

  const expiresAt = new Date(otpRow.expires_at);
  if (expiresAt.getTime() < Date.now()) {
    await client.query(`UPDATE admin_otps SET is_active = false WHERE id = $1`, [otpRow.id]);
    return { status: 'otp_expired' as const };
  }

  if (otpRow.attempts >= config.otpMaxAttempts) {
    await client.query(`UPDATE admin_otps SET is_active = false WHERE id = $1`, [otpRow.id]);
    return { status: 'too_many_attempts' as const };
  }

  const submittedHash = hashOtp(params.otp);
  if (submittedHash !== otpRow.otp_hash) {
    const updateResult = await client.query(
      `UPDATE admin_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
      [otpRow.id]
    );
    const attemptsRow = updateResult.rows[0] as { attempts?: number | string } | undefined;
    const attempts = Number(attemptsRow?.attempts ?? otpRow.attempts + 1);
    await insertAdminAction(client, {
      adminId: params.adminId,
      action: 'invalid_otp_attempt',
      targetId: params.adminId,
      targetType: 'admin',
      details: { attempts, purpose: params.purpose },
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const attemptsLeft = Math.max(config.otpMaxAttempts - attempts, 0);
    return { status: 'invalid_otp' as const, attemptsLeft };
  }

  await client.query(`UPDATE admin_otps SET is_used = true, is_active = false WHERE id = $1`, [
    otpRow.id,
  ]);
  return { status: 'valid' as const, otpId: otpRow.id };
};

export const sendSuperAdminPasswordOtp = async (req: Request, res: Response) => {
  const admin = getAdminPayload(req, res);
  if (!admin) return;
  if (admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { credentialType, email, newPassword, confirmPassword } = req.body as {
    credentialType?: 'login' | 'action';
    email?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  if (!credentialType || !email || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (credentialType !== 'login' && credentialType !== 'action') {
    return res.status(400).json({ error: 'invalid_credential_type' });
  }
  if (!PASSWORD_REGEX.test(newPassword)) {
    return res.status(400).json({ error: 'invalid_password' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'password_mismatch' });
  }

  const client = await pool.connect();
  try {
    const adminResult = await client.query(
      `SELECT admin_id, email_address, login_password_hash, action_password_hash
       FROM admins WHERE admin_id = $1`,
      [admin.adminId]
    );
    const adminRow = adminResult.rows[0];
    if (!adminRow) {
      return res.status(404).json({ error: 'admin_not_found' });
    }
    const storedEmail = (adminRow.email_address ?? '').toLowerCase().trim();
    if (!storedEmail || storedEmail !== email.toLowerCase().trim()) {
      return res.status(400).json({ error: 'email_mismatch' });
    }

    const purpose = `edit_password_${credentialType}`;
    const resendStatus = await checkOtpResend(client, admin.adminId, [purpose]);
    if (resendStatus.status === 'cooldown') {
      return res.status(429).json({
        error: 'cooldown',
        next_resend_allowed_at: resendStatus.nextAllowedAt,
      });
    }
    if (resendStatus.status === 'resend_limited') {
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    const otp = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await client.query('BEGIN');
    await client.query(
      `UPDATE admin_otps SET is_active = false
       WHERE admin_id = $1 AND purpose = $2 AND is_active = true`,
      [admin.adminId, purpose]
    );
    await client.query(
      `INSERT INTO admin_otps (
        admin_id, purpose, sent_to, otp_hash, created_at, expires_at, is_used, is_active, attempts, ip_address, user_agent
      )
      VALUES ($1, $2, $3, $4, NOW(), $5, false, true, 0, $6, $7)`,
      [
        admin.adminId,
        purpose,
        storedEmail,
        otpHash,
        expiresAt.toISOString(),
        req.ip ?? null,
        req.get('user-agent') ?? null,
      ]
    );
    await insertAdminAction(client, {
      adminId: admin.adminId,
      action: 'credential_otp_sent',
      targetId: admin.adminId,
      targetType: 'admin',
      details: { credentialType, mode: 'password' },
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
    await client.query('COMMIT');

    await sendOtpEmail(storedEmail, otp, 'DM Bingo Admin Verification Code');
    return res.json({
      status: 'otp_sent',
      expiresAt: expiresAt.toISOString(),
      nextResendAllowedAt: new Date(Date.now() + config.otpResendCooldownSeconds * 1000).toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const updateSuperAdminPassword = async (req: Request, res: Response) => {
  const admin = getAdminPayload(req, res);
  if (!admin) return;
  if (admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { credentialType, email, newPassword, confirmPassword, otp } = req.body as {
    credentialType?: 'login' | 'action';
    email?: string;
    newPassword?: string;
    confirmPassword?: string;
    otp?: string;
  };

  if (!credentialType || !email || !newPassword || !confirmPassword || !otp) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (credentialType !== 'login' && credentialType !== 'action') {
    return res.status(400).json({ error: 'invalid_credential_type' });
  }
  if (!PASSWORD_REGEX.test(newPassword)) {
    return res.status(400).json({ error: 'invalid_password' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'password_mismatch' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adminResult = await client.query(
      `SELECT admin_id, email_address FROM admins WHERE admin_id = $1`,
      [admin.adminId]
    );
    const adminRow = adminResult.rows[0];
    if (!adminRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'admin_not_found' });
    }
    const storedEmail = (adminRow.email_address ?? '').toLowerCase().trim();
    if (!storedEmail || storedEmail !== email.toLowerCase().trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'email_mismatch' });
    }

    const validation = await validateOtp(client, {
      adminId: admin.adminId,
      purpose: `edit_password_${credentialType}`,
      otp,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });

    if (validation.status === 'invalid_otp') {
      await client.query('COMMIT');
      return res.status(401).json({ error: 'invalid_otp', attempts_left: validation.attemptsLeft });
    }
    if (validation.status === 'otp_expired') {
      await client.query('COMMIT');
      return res.status(410).json({ error: 'otp_expired' });
    }
    if (validation.status === 'too_many_attempts') {
      await client.query('COMMIT');
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    if (validation.status === 'no_active_otp') {
      await client.query('COMMIT');
      return res.status(400).json({ error: 'no_active_otp' });
    }

    const field = credentialType === 'login' ? 'login_password_hash' : 'action_password_hash';
    const currentHash = adminRow[field];
    if (currentHash && (await argon2.verify(currentHash, newPassword))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'same_password' });
    }
    const hash = await argon2.hash(newPassword);
    await client.query(
      `UPDATE admins SET ${field} = $1, updated_at = NOW() WHERE admin_id = $2`,
      [hash, admin.adminId]
    );
    await insertAdminAction(client, {
      adminId: admin.adminId,
      action: 'credential_updated',
      targetId: admin.adminId,
      targetType: 'admin',
      details: { credentialType, mode: 'password' },
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
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

export const sendSuperAdminEmailOtp = async (req: Request, res: Response) => {
  const admin = getAdminPayload(req, res);
  if (!admin) return;
  if (admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { currentEmail, newEmail } = req.body as { currentEmail?: string; newEmail?: string };
  if (!currentEmail || !newEmail) {
    return res.status(400).json({ error: 'missing_fields' });
  }
    if (!EMAIL_REGEX.test(currentEmail) || !EMAIL_REGEX.test(newEmail)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const client = await pool.connect();
  try {
    const adminResult = await client.query(
      `SELECT admin_id, email_address FROM admins WHERE admin_id = $1`,
      [admin.adminId]
    );
    const adminRow = adminResult.rows[0];
    if (!adminRow) {
      return res.status(404).json({ error: 'admin_not_found' });
    }
    const storedEmail = (adminRow.email_address ?? '').toLowerCase().trim();
    if (!storedEmail || storedEmail !== currentEmail.toLowerCase().trim()) {
      return res.status(400).json({ error: 'email_mismatch' });
    }
    if (storedEmail === newEmail.toLowerCase().trim()) {
      return res.status(400).json({ error: 'same_email' });
    }

    const resendStatus = await checkOtpResend(client, admin.adminId, [
      'edit_email_current',
      'edit_email_new',
    ]);
    if (resendStatus.status === 'cooldown') {
      return res.status(429).json({
        error: 'cooldown',
        next_resend_allowed_at: resendStatus.nextAllowedAt,
      });
    }
    if (resendStatus.status === 'resend_limited') {
      return res.status(429).json({ error: 'too_many_attempts' });
    }

    const otpCurrent = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const otpNew = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await client.query('BEGIN');
    await client.query(
      `UPDATE admin_otps SET is_active = false
       WHERE admin_id = $1 AND purpose IN ('edit_email_current','edit_email_new') AND is_active = true`,
      [admin.adminId]
    );
    await client.query(
      `INSERT INTO admin_otps (admin_id, purpose, sent_to, otp_hash, created_at, expires_at, is_used, is_active, attempts, ip_address, user_agent)
       VALUES ($1, 'edit_email_current', $2, $3, NOW(), $4, false, true, 0, $5, $6)`,
      [
        admin.adminId,
        storedEmail,
        hashOtp(otpCurrent),
        expiresAt.toISOString(),
        req.ip ?? null,
        req.get('user-agent') ?? null,
      ]
    );
    await client.query(
      `INSERT INTO admin_otps (admin_id, purpose, sent_to, otp_hash, created_at, expires_at, is_used, is_active, attempts, ip_address, user_agent)
       VALUES ($1, 'edit_email_new', $2, $3, NOW(), $4, false, true, 0, $5, $6)`,
      [
        admin.adminId,
        newEmail.toLowerCase().trim(),
        hashOtp(otpNew),
        expiresAt.toISOString(),
        req.ip ?? null,
        req.get('user-agent') ?? null,
      ]
    );
    await insertAdminAction(client, {
      adminId: admin.adminId,
      action: 'credential_otp_sent',
      targetId: admin.adminId,
      targetType: 'admin',
      details: { mode: 'email', newEmail: newEmail.toLowerCase().trim() },
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
    await client.query('COMMIT');

    await sendOtpEmail(storedEmail, otpCurrent, 'DM Bingo Email Change Code');
    await sendOtpEmail(newEmail, otpNew, 'DM Bingo Email Change Code');
    return res.json({
      status: 'otp_sent',
      expiresAt: expiresAt.toISOString(),
      nextResendAllowedAt: new Date(Date.now() + config.otpResendCooldownSeconds * 1000).toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const updateSuperAdminEmail = async (req: Request, res: Response) => {
  const admin = getAdminPayload(req, res);
  if (!admin) return;
  if (admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { currentEmail, newEmail, currentEmailOtp, newEmailOtp } = req.body as {
    currentEmail?: string;
    newEmail?: string;
    currentEmailOtp?: string;
    newEmailOtp?: string;
  };
  if (!currentEmail || !newEmail || !currentEmailOtp || !newEmailOtp) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (!EMAIL_REGEX.test(currentEmail) || !EMAIL_REGEX.test(newEmail)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adminResult = await client.query(
      `SELECT admin_id, email_address FROM admins WHERE admin_id = $1`,
      [admin.adminId]
    );
    const adminRow = adminResult.rows[0];
    if (!adminRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'admin_not_found' });
    }
    const storedEmail = (adminRow.email_address ?? '').toLowerCase().trim();
    if (!storedEmail || storedEmail !== currentEmail.toLowerCase().trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'email_mismatch' });
    }
    if (storedEmail === newEmail.toLowerCase().trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'same_email' });
    }

    const currentOtp = await getActiveOtp(client, admin.adminId, 'edit_email_current');
    const newOtp = await getActiveOtp(client, admin.adminId, 'edit_email_new');
    if (!currentOtp || !newOtp) {
      await client.query('COMMIT');
      return res.status(400).json({ error: 'no_active_otp' });
    }

    const now = Date.now();
    const currentExpires = new Date(currentOtp.expires_at).getTime();
    const newExpires = new Date(newOtp.expires_at).getTime();
    if (currentExpires < now || newExpires < now) {
      await client.query(`UPDATE admin_otps SET is_active = false WHERE id = ANY($1)`, [
        [currentOtp.id, newOtp.id],
      ]);
      await client.query('COMMIT');
      return res.status(410).json({ error: 'otp_expired' });
    }
    if (currentOtp.attempts >= config.otpMaxAttempts || newOtp.attempts >= config.otpMaxAttempts) {
      await client.query(`UPDATE admin_otps SET is_active = false WHERE id = ANY($1)`, [
        [currentOtp.id, newOtp.id],
      ]);
      await client.query('COMMIT');
      return res.status(429).json({ error: 'too_many_attempts' });
    }

    const currentHash = hashOtp(currentEmailOtp);
    const newHash = hashOtp(newEmailOtp);
    if (currentHash !== currentOtp.otp_hash || newHash !== newOtp.otp_hash) {
      const updates: Array<{ id: number; attempts: number }> = [];
      if (currentHash !== currentOtp.otp_hash) {
        const update = await client.query(
          `UPDATE admin_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
          [currentOtp.id]
        );
        updates.push({ id: currentOtp.id, attempts: Number(update.rows[0]?.attempts ?? currentOtp.attempts + 1) });
      }
      if (newHash !== newOtp.otp_hash) {
        const update = await client.query(
          `UPDATE admin_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
          [newOtp.id]
        );
        updates.push({ id: newOtp.id, attempts: Number(update.rows[0]?.attempts ?? newOtp.attempts + 1) });
      }
      await insertAdminAction(client, {
        adminId: admin.adminId,
        action: 'invalid_otp_attempt',
        targetId: admin.adminId,
        targetType: 'admin',
        details: { attempts: updates, purpose: 'edit_email' },
        ip: req.ip,
        userAgent: req.get('user-agent') ?? null,
      });
      await client.query('COMMIT');
      return res.status(401).json({ error: 'invalid_otp' });
    }

    await client.query(
      `UPDATE admin_otps SET is_used = true, is_active = false WHERE id = ANY($1)`,
      [[currentOtp.id, newOtp.id]]
    );
    await client.query(
      `UPDATE admins SET email_address = $1, updated_at = NOW() WHERE admin_id = $2`,
      [newEmail.toLowerCase().trim(), admin.adminId]
    );
    await insertAdminAction(client, {
      adminId: admin.adminId,
      action: 'credential_updated',
      targetId: admin.adminId,
      targetType: 'admin',
      details: { mode: 'email', oldEmail: storedEmail, newEmail: newEmail.toLowerCase().trim() },
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
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

export const updateWithdrawalAdminPassword = async (req: Request, res: Response) => {
  const admin = getAdminPayload(req, res);
  if (!admin) return;
  if (admin.role !== 'withdrawal_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }

  const { credentialType, currentActionPassword, newPassword, confirmPassword } = req.body as {
    credentialType?: 'login' | 'action';
    currentActionPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  if (!credentialType || !currentActionPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (credentialType !== 'login' && credentialType !== 'action') {
    return res.status(400).json({ error: 'invalid_credential_type' });
  }
  if (!PASSWORD_REGEX.test(newPassword)) {
    return res.status(400).json({ error: 'invalid_password' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'password_mismatch' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adminResult = await client.query(
      `SELECT admin_id, login_password_hash, action_password_hash FROM admins WHERE admin_id = $1`,
      [admin.adminId]
    );
    const adminRow = adminResult.rows[0];
    if (!adminRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'admin_not_found' });
    }
    const passwordOk = await argon2.verify(adminRow.action_password_hash, currentActionPassword);
    if (!passwordOk) {
      await client.query('COMMIT');
      return res.status(401).json({ error: 'invalid_action_password' });
    }

    const field = credentialType === 'login' ? 'login_password_hash' : 'action_password_hash';
    const currentHash = adminRow[field];
    if (currentHash && (await argon2.verify(currentHash, newPassword))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'same_password' });
    }
    const hash = await argon2.hash(newPassword);
    await client.query(
      `UPDATE admins SET ${field} = $1, updated_at = NOW() WHERE admin_id = $2`,
      [hash, admin.adminId]
    );
    await insertAdminAction(client, {
      adminId: admin.adminId,
      action: 'credential_updated',
      targetId: admin.adminId,
      targetType: 'admin',
      details: { credentialType, mode: 'withdrawal_password' },
      ip: req.ip,
      userAgent: req.get('user-agent') ?? null,
    });
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
