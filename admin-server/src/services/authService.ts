import argon2 from 'argon2';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import { Resend } from 'resend';
import { config } from '../config';
import { db } from '../db/drizzle';

type AdminRow = {
  admin_id: number;
  username: string;
  login_password_hash: string;
  action_password_hash: string;
  role: 'super_admin' | 'withdrawal_admin';
  is_active: boolean;
  failed_login_attempts: number;
  locked_at: string | null;
  email_address: string | null;
};

type OtpRow = {
  id: number;
  admin_id: number;
  otp_hash: string;
  expires_at: string;
  is_active: boolean;
  is_used: boolean;
  attempts: number;
  created_at: string;
};

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

const toAdminRow = (row: unknown): AdminRow => row as AdminRow;
const toOtpRow = (row: unknown): OtpRow => row as OtpRow;

const hashOtp = (otp: string) =>
  crypto.createHmac('sha256', config.otpSecret).update(otp).digest('hex');

const insertAdminAction = async (params: {
  adminId: number | null;
  action: string;
  targetId?: number | null;
  targetType?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  const detailsJson = JSON.stringify(params.details ?? {});
  await db.execute(
    sql`
      INSERT INTO admin_actions (
        admin_id,
        action,
        target_id,
        target_type,
        details,
        ip_address,
        user_agent
      )
      VALUES (
        ${params.adminId},
        ${params.action},
        ${params.targetId ?? null},
        ${params.targetType ?? null},
        ${detailsJson}::jsonb,
        ${params.ip ?? null},
        ${params.userAgent ?? null}
      )
    `
  );
};

const findAdminByUsername = async (username: string) => {
  const result = await db.execute(
    sql`
      SELECT
        admin_id,
        username,
        login_password_hash,
        action_password_hash,
        role,
        is_active,
        failed_login_attempts,
        locked_at,
        email_address
      FROM admins
      WHERE username = ${username}
      LIMIT 1
    `
  );
  return result.rows.length ? toAdminRow(result.rows[0]) : null;
};

const updateFailedAttempts = async (adminId: number) => {
  const result = await db.execute(
    sql`
      UPDATE admins
      SET failed_login_attempts = failed_login_attempts + 1
      WHERE admin_id = ${adminId}
      RETURNING failed_login_attempts, role
    `
  );
  return result.rows.length
    ? {
        failed_login_attempts: Number(result.rows[0].failed_login_attempts),
        role: result.rows[0].role as AdminRow['role'],
      }
    : null;
};

const lockAdmin = async (adminId: number) => {
  await db.execute(
    sql`
      UPDATE admins
      SET is_active = false, locked_at = NOW()
      WHERE admin_id = ${adminId}
    `
  );
};

const resetLoginAttempts = async (adminId: number) => {
  await db.execute(
    sql`
      UPDATE admins
      SET failed_login_attempts = 0, last_login = NOW()
      WHERE admin_id = ${adminId}
    `
  );
};

const createTokens = (adminId: number, role: AdminRow['role']) => {
  if (!config.jwtSecret || !config.jwtRefreshSecret) {
    throw new Error('JWT_SECRET_ADMIN is required');
  }
  const accessToken = jwt.sign({ adminId, role }, config.jwtSecret, {
    expiresIn: config.accessTokenTtl as jwt.SignOptions['expiresIn'],
  });
  const refreshToken = jwt.sign(
    { adminId, role, tokenType: 'refresh' },
    config.jwtRefreshSecret,
    {
      expiresIn: config.refreshTokenTtl as jwt.SignOptions['expiresIn'],
    }
  );
  return { accessToken, refreshToken };
};

const sendOtpEmail = async (to: string, otp: string) => {
  if (!resend) {
    return;
  }
  await resend.emails.send({
    from: config.resendFrom,
    to,
    subject: 'DM Bingo Admin Verification Code',
    html: `<p>Your verification code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
  });
};

export const loginAdmin = async (params: {
  username: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  const admin = await findAdminByUsername(params.username);
  if (!admin) {
    return { status: 'invalid' as const };
  }

  if (!admin.is_active) {
    await insertAdminAction({
      adminId: admin.admin_id,
      action: 'login_attempt',
      details: { result: 'locked' },
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return {
      status: 'locked' as const,
      role: admin.role,
      message:
        admin.role === 'super_admin'
          ? 'The account is deactivated'
          : 'Account locked — Reach out Super Admin for reactivation.',
    };
  }

  const passwordOk = await argon2.verify(admin.login_password_hash, params.password);
  if (passwordOk) {
    await resetLoginAttempts(admin.admin_id);
    await insertAdminAction({
      adminId: admin.admin_id,
      action: 'login',
      details: { result: 'success' },
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const tokens = createTokens(admin.admin_id, admin.role);
    return {
      status: 'success' as const,
      tokens,
      role: admin.role,
    };
  }

  const failedUpdate = await updateFailedAttempts(admin.admin_id);
  const failedCount = failedUpdate?.failed_login_attempts ?? admin.failed_login_attempts + 1;
  await insertAdminAction({
    adminId: admin.admin_id,
    action: 'login_attempt',
    details: { result: 'bad_password', failed_login_attempts: failedCount },
    ip: params.ip,
    userAgent: params.userAgent,
  });

  const threshold = admin.role === 'super_admin' ? 10 : 5;
  if (failedCount >= threshold) {
    await lockAdmin(admin.admin_id);
    await insertAdminAction({
      adminId: admin.admin_id,
      action: 'account_locked',
      details: { by: 'failed_attempts', threshold, failed_login_attempts: failedCount },
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }

  return { status: 'invalid' as const };
};

export const refreshAdminToken = async (token: string) => {
  if (!config.jwtRefreshSecret) {
    throw new Error('JWT_REFRESH_SECRET_ADMIN is required');
  }
  const payload = jwt.verify(token, config.jwtRefreshSecret) as {
    adminId: number;
    role: AdminRow['role'];
    tokenType?: string;
  };
  if (payload.tokenType !== 'refresh') {
    throw new Error('Invalid refresh token');
  }
  const tokens = createTokens(payload.adminId, payload.role);
  return { tokens, role: payload.role };
};

export const forgotStart = async (username: string) => {
  const admin = await findAdminByUsername(username);
  if (!admin) {
    return { status: 'unknown_username' as const };
  }
  await insertAdminAction({
    adminId: admin.admin_id,
    action: 'forgot_request',
    targetId: admin.admin_id,
    targetType: 'admin',
  });
  if (admin.role === 'withdrawal_admin' && !admin.is_active) {
    return { status: 'locked_withdrawal_admin' as const };
  }
  if (admin.role === 'withdrawal_admin' && admin.is_active) {
    return { status: 'active_withdrawal_admin' as const };
  }
  return { status: 'super_admin' as const, adminId: admin.admin_id, email: admin.email_address };
};

export const forgotVerifyEmail = async (params: {
  username: string;
  email: string;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  const admin = await findAdminByUsername(params.username);
  if (!admin || admin.role !== 'super_admin') {
    return { status: 'invalid' as const };
  }

  const storedEmail = admin.email_address?.toLowerCase().trim() ?? '';
  const submittedEmail = params.email.toLowerCase().trim();

  if (!storedEmail || storedEmail !== submittedEmail) {
    return { status: 'email_mismatch' as const };
  }

  await db.execute(
    sql`
      UPDATE admin_otps
      SET is_active = false
      WHERE admin_id = ${admin.admin_id}
        AND purpose = 'reactivate'
        AND is_active = true
    `
  );

  const otp = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await db.execute(
    sql`
      INSERT INTO admin_otps (
        admin_id,
        purpose,
        sent_to,
        otp_hash,
        created_at,
        expires_at,
        is_used,
        is_active,
        attempts,
        ip_address,
        user_agent
      )
      VALUES (
        ${admin.admin_id},
        'reactivate',
        ${admin.email_address},
        ${otpHash},
        NOW(),
        ${expiresAt.toISOString()},
        false,
        true,
        0,
        ${params.ip ?? null},
        ${params.userAgent ?? null}
      )
    `
  );

  await insertAdminAction({
    adminId: admin.admin_id,
    action: 'forgot_password_sent',
    targetId: admin.admin_id,
    targetType: 'admin',
    details: { via: 'email' },
    ip: params.ip,
    userAgent: params.userAgent,
  });

  await sendOtpEmail(admin.email_address ?? '', otp);

  return {
    status: 'otp_sent' as const,
    expiresAt: expiresAt.toISOString(),
    nextResendAllowedAt: new Date(Date.now() + config.otpResendCooldownSeconds * 1000).toISOString(),
  };
};

export const forgotValidateOtp = async (params: {
  username: string;
  otp: string;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  const admin = await findAdminByUsername(params.username);
  if (!admin) {
    return { status: 'invalid' as const };
  }

  const otpResult = await db.execute(
    sql`
      SELECT *
      FROM admin_otps
      WHERE admin_id = ${admin.admin_id}
        AND purpose = 'reactivate'
        AND is_active = true
      ORDER BY created_at DESC
      LIMIT 1
    `
  );

  if (!otpResult.rows.length) {
    return { status: 'no_active_otp' as const };
  }

  const otpRow = toOtpRow(otpResult.rows[0]);
  const expiresAt = new Date(otpRow.expires_at);
  if (expiresAt.getTime() < Date.now()) {
    await db.execute(
      sql`
        UPDATE admin_otps
        SET is_active = false
        WHERE id = ${otpRow.id}
      `
    );
    return { status: 'otp_expired' as const };
  }

  if (otpRow.attempts >= config.otpMaxAttempts) {
    await db.execute(
      sql`
        UPDATE admin_otps
        SET is_active = false
        WHERE id = ${otpRow.id}
      `
    );
    return { status: 'too_many_attempts' as const };
  }

  const submittedHash = hashOtp(params.otp);
  if (submittedHash !== otpRow.otp_hash) {
    const updateResult = await db.execute(
      sql`
        UPDATE admin_otps
        SET attempts = attempts + 1
        WHERE id = ${otpRow.id}
        RETURNING attempts
      `
    );
    const attempts = Number(updateResult.rows[0]?.attempts ?? otpRow.attempts + 1);
    await insertAdminAction({
      adminId: admin.admin_id,
      action: 'invalid_otp_attempt',
      targetId: admin.admin_id,
      targetType: 'admin',
      details: { attempts },
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const attemptsLeft = Math.max(config.otpMaxAttempts - attempts, 0);
    return { status: 'invalid_otp' as const, attemptsLeft };
  }

  await db.execute(
    sql`
      UPDATE admin_otps
      SET is_used = true, is_active = false
      WHERE id = ${otpRow.id}
    `
  );

  await db.execute(
    sql`
      UPDATE admins
      SET is_active = true, failed_login_attempts = 0, locked_at = NULL
      WHERE admin_id = ${admin.admin_id}
    `
  );

  await insertAdminAction({
    adminId: admin.admin_id,
    action: 'reactivate_via_otp',
    targetId: admin.admin_id,
    targetType: 'admin',
    ip: params.ip,
    userAgent: params.userAgent,
  });

  const tokens = createTokens(admin.admin_id, admin.role);
  return { status: 'reactivated' as const, tokens, role: admin.role };
};

export const forgotResetPassword = async (params: {
  username: string;
  otp: string;
  newPassword: string;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  const admin = await findAdminByUsername(params.username);
  if (!admin) {
    return { status: 'invalid' as const };
  }

  const otpResult = await db.execute(
    sql`
      SELECT *
      FROM admin_otps
      WHERE admin_id = ${admin.admin_id}
        AND purpose = 'reactivate'
        AND is_active = true
      ORDER BY created_at DESC
      LIMIT 1
    `
  );

  if (!otpResult.rows.length) {
    return { status: 'no_active_otp' as const };
  }

  const otpRow = toOtpRow(otpResult.rows[0]);
  const expiresAt = new Date(otpRow.expires_at);
  if (expiresAt.getTime() < Date.now()) {
    await db.execute(
      sql`
        UPDATE admin_otps
        SET is_active = false
        WHERE id = ${otpRow.id}
      `
    );
    return { status: 'otp_expired' as const };
  }

  if (otpRow.attempts >= config.otpMaxAttempts) {
    await db.execute(
      sql`
        UPDATE admin_otps
        SET is_active = false
        WHERE id = ${otpRow.id}
      `
    );
    return { status: 'too_many_attempts' as const };
  }

  const submittedHash = hashOtp(params.otp);
  if (submittedHash !== otpRow.otp_hash) {
    const updateResult = await db.execute(
      sql`
        UPDATE admin_otps
        SET attempts = attempts + 1
        WHERE id = ${otpRow.id}
        RETURNING attempts
      `
    );
    const attempts = Number(updateResult.rows[0]?.attempts ?? otpRow.attempts + 1);
    await insertAdminAction({
      adminId: admin.admin_id,
      action: 'invalid_otp_attempt',
      targetId: admin.admin_id,
      targetType: 'admin',
      details: { attempts },
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const attemptsLeft = Math.max(config.otpMaxAttempts - attempts, 0);
    return { status: 'invalid_otp' as const, attemptsLeft };
  }

  const loginHash = await argon2.hash(params.newPassword);

  await db.execute(
    sql`
      UPDATE admin_otps
      SET is_used = true, is_active = false
      WHERE id = ${otpRow.id}
    `
  );

  await db.execute(
    sql`
      UPDATE admins
      SET
        login_password_hash = ${loginHash},
        is_active = true,
        failed_login_attempts = 0,
        locked_at = NULL,
        updated_at = NOW()
      WHERE admin_id = ${admin.admin_id}
    `
  );

  await insertAdminAction({
    adminId: admin.admin_id,
    action: 'password_reset',
    targetId: admin.admin_id,
    targetType: 'admin',
    ip: params.ip,
    userAgent: params.userAgent,
  });

  const tokens = createTokens(admin.admin_id, admin.role);
  return { status: 'reset' as const, tokens, role: admin.role };
};

export const forgotResendOtp = async (params: {
  username: string;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  const admin = await findAdminByUsername(params.username);
  if (!admin || admin.role !== 'super_admin') {
    return { status: 'invalid' as const };
  }

  const recentCount = await db.execute(
    sql`
      SELECT COUNT(*) AS count
      FROM admin_otps
      WHERE admin_id = ${admin.admin_id}
        AND purpose = 'reactivate'
        AND created_at > NOW() - INTERVAL '${config.otpResendLimitWindowHours} hours'
    `
  );
  const count = Number(recentCount.rows[0]?.count ?? 0);
  if (count >= config.otpResendLimitMax) {
    return { status: 'resend_limited' as const };
  }

  const latestOtp = await db.execute(
    sql`
      SELECT created_at
      FROM admin_otps
      WHERE admin_id = ${admin.admin_id}
        AND purpose = 'reactivate'
      ORDER BY created_at DESC
      LIMIT 1
    `
  );

  if (latestOtp.rows.length) {
    const createdAt = new Date(latestOtp.rows[0].created_at as string);
    const nextAllowed = new Date(
      createdAt.getTime() + config.otpResendCooldownSeconds * 1000
    );
    if (Date.now() < nextAllowed.getTime()) {
      return { status: 'cooldown' as const, nextAllowedAt: nextAllowed.toISOString() };
    }
  }

  await db.execute(
    sql`
      UPDATE admin_otps
      SET is_active = false
      WHERE admin_id = ${admin.admin_id}
        AND purpose = 'reactivate'
        AND is_active = true
    `
  );

  const otp = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await db.execute(
    sql`
      INSERT INTO admin_otps (
        admin_id,
        purpose,
        sent_to,
        otp_hash,
        created_at,
        expires_at,
        is_used,
        is_active,
        attempts,
        ip_address,
        user_agent
      )
      VALUES (
        ${admin.admin_id},
        'reactivate',
        ${admin.email_address},
        ${otpHash},
        NOW(),
        ${expiresAt.toISOString()},
        false,
        true,
        0,
        ${params.ip ?? null},
        ${params.userAgent ?? null}
      )
    `
  );

  await insertAdminAction({
    adminId: admin.admin_id,
    action: 'forgot_password_resent',
    targetId: admin.admin_id,
    targetType: 'admin',
    ip: params.ip,
    userAgent: params.userAgent,
  });

  await sendOtpEmail(admin.email_address ?? '', otp);

  return {
    status: 'otp_resent' as const,
    nextResendAllowedAt: new Date(Date.now() + config.otpResendCooldownSeconds * 1000).toISOString(),
  };
};
