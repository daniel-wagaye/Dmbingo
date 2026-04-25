import type { Request, Response } from 'express';
import {
  forgotResendOtp,
  forgotStart,
  forgotResetPassword,
  forgotValidateOtp,
  forgotVerifyEmail,
  loginAdmin,
  refreshAdminToken,
} from '../services/authService';

const isSecure = process.env.NODE_ENV === 'production' ||
  (process.env.ADMIN_CLIENT_ORIGIN ?? '').startsWith('https');
const rateLimits = new Map<string, { count: number; resetAt: number }>();

const checkRateLimit = (key: string, limit: number, windowMs: number) => {
  const now = Date.now();
  const existing = rateLimits.get(key);
  if (!existing || existing.resetAt < now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) {
    return false;
  }
  existing.count += 1;
  return true;
};

export const cookieSameSite: 'none' | 'lax' = isSecure ? 'none' : 'lax';
export const isSecureCookie = isSecure;

export const setAuthCookies = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
) => {
  res.cookie('admin_access_token', tokens.accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: cookieSameSite,
    maxAge: 2 * 60 * 60 * 1000,
  });
  res.cookie('admin_refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: cookieSameSite,
    maxAge: 2 * 60 * 60 * 1000,
  });
};

const clearAuthCookies = (res: Response) => {
  res.clearCookie('admin_access_token', { httpOnly: true, secure: isSecure, sameSite: cookieSameSite });
  res.clearCookie('admin_refresh_token', { httpOnly: true, secure: isSecure, sameSite: cookieSameSite });
};

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: 'missing_credentials' });
  }

  const result = await loginAdmin({
    username,
    password,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? null,
  });

  if (result.status === 'success') {
    setAuthCookies(res, result.tokens);
    return res.json({
      role: result.role,
      redirect: result.role === 'super_admin' ? '/admin/dashboard' : '/admin/withdrawals/pending',
    });
  }

  if (result.status === 'locked') {
    return res.status(403).json({ error: 'account_locked', message: result.message });
  }

  return res.status(401).json({ error: 'invalid_credentials' });
};

export const refresh = async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.admin_refresh_token as string | undefined;
  if (!refreshToken) {
    return res.status(401).json({ error: 'missing_refresh_token' });
  }

  try {
    const result = await refreshAdminToken(refreshToken);
    setAuthCookies(res, result.tokens);
    return res.json({ role: result.role });
  } catch {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
};

export const logout = async (_req: Request, res: Response) => {
  clearAuthCookies(res);
  return res.json({ status: 'ok' });
};

export const forgot = async (req: Request, res: Response) => {
  const { username } = req.body as { username?: string };
  if (!username) {
    return res.status(400).json({ error: 'missing_username' });
  }
  const ipKey = `${req.ip}:forgot`;
  if (!checkRateLimit(ipKey, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const result = await forgotStart(username);
  if (result.status === 'unknown_username') {
    return res.status(404).json({ error: 'unknown_username' });
  }
  return res.json(result);
};

export const verifyEmail = async (req: Request, res: Response) => {
  const { username, email } = req.body as { username?: string; email?: string };
  if (!username || !email) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const ipKey = `${req.ip}:verify-email`;
  if (!checkRateLimit(ipKey, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const result = await forgotVerifyEmail({
    username,
    email,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? null,
  });

  if (result.status === 'email_mismatch') {
    return res.status(400).json({ error: 'email_mismatch' });
  }
  if (result.status !== 'otp_sent') {
    return res.status(400).json({ error: 'invalid_request' });
  }

  return res.json(result);
};

export const resetPassword = async (req: Request, res: Response) => {
  const { username, otp, newPassword } = req.body as {
    username?: string;
    otp?: string;
    newPassword?: string;
  };
  if (!username || !otp || !newPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}$/;
  if (!passwordPolicy.test(newPassword)) {
    return res.status(400).json({ error: 'weak_password' });
  }

  const ipKey = `${req.ip}:reset-password`;
  if (!checkRateLimit(ipKey, 15, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const result = await forgotResetPassword({
    username,
    otp,
    newPassword,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? null,
  });

  if (result.status === 'reset') {
    setAuthCookies(res, result.tokens);
    return res.json({
      status: 'reset',
      role: result.role,
      redirect: '/admin/dashboard',
    });
  }

  if (result.status === 'invalid_otp') {
    return res.status(401).json({ error: 'invalid_otp', attempts_left: result.attemptsLeft });
  }
  if (result.status === 'otp_expired') {
    return res.status(410).json({ error: 'otp_expired' });
  }
  if (result.status === 'too_many_attempts') {
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  if (result.status === 'no_active_otp') {
    return res.status(400).json({ error: 'no_active_otp' });
  }

  return res.status(400).json({ error: 'invalid_request' });
};

export const validateOtp = async (req: Request, res: Response) => {
  const { username, otp } = req.body as { username?: string; otp?: string };
  if (!username || !otp) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const ipKey = `${req.ip}:validate-otp`;
  if (!checkRateLimit(ipKey, 15, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const result = await forgotValidateOtp({
    username,
    otp,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? null,
  });

  if (result.status === 'reactivated') {
    setAuthCookies(res, result.tokens);
    return res.json({
      status: 'reactivated',
      role: result.role,
      redirect: '/admin/dashboard',
    });
  }

  if (result.status === 'invalid_otp') {
    return res.status(401).json({ error: 'invalid_otp', attempts_left: result.attemptsLeft });
  }
  if (result.status === 'otp_expired') {
    return res.status(410).json({ error: 'otp_expired' });
  }
  if (result.status === 'too_many_attempts') {
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  if (result.status === 'no_active_otp') {
    return res.status(400).json({ error: 'no_active_otp' });
  }

  return res.status(400).json({ error: 'invalid_request' });
};

export const resendOtp = async (req: Request, res: Response) => {
  const { username } = req.body as { username?: string };
  if (!username) {
    return res.status(400).json({ error: 'missing_username' });
  }
  const ipKey = `${req.ip}:resend-otp`;
  if (!checkRateLimit(ipKey, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const result = await forgotResendOtp({
    username,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? null,
  });

  if (result.status === 'cooldown') {
    return res.status(429).json({
      error: 'cooldown',
      next_resend_allowed_at: result.nextAllowedAt,
    });
  }
  if (result.status === 'resend_limited') {
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  if (result.status === 'otp_resent') {
    return res.json(result);
  }

  return res.status(400).json({ error: 'invalid_request' });
};
