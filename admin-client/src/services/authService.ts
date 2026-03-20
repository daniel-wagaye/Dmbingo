const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

const request = async <T>(path: string, options: RequestInit) => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    credentials: 'include',
  });

  const data = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const error = data as { error?: string; message?: string };
    const err = new Error(error.message ?? error.error ?? 'Request failed');
    (err as Error & { data?: unknown }).data = data;
    throw err;
  }
  return data;
};

export const login = async (payload: { username: string; password: string }) =>
  request<{ role: string; redirect: string }>('/admin/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const forgotStart = async (payload: { username: string }) =>
  request<
    | { status: 'locked_withdrawal_admin' }
    | { status: 'active_withdrawal_admin' }
    | { status: 'super_admin' }
  >('/admin/forgot', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const forgotVerifyEmail = async (payload: { username: string; email: string }) =>
  request<{ status: 'otp_sent'; expiresAt: string; nextResendAllowedAt: string }>(
    '/admin/forgot/verify-email',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

export const forgotValidateOtp = async (payload: { username: string; otp: string }) =>
  request<{ status: 'reactivated'; redirect: string; role: string }>('/admin/forgot/validate-otp', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const forgotResetPassword = async (payload: {
  username: string;
  otp: string;
  newPassword: string;
}) =>
  request<{ status: 'reset'; redirect: string; role: string }>('/admin/forgot/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const forgotResendOtp = async (payload: { username: string }) =>
  request<{ status: 'otp_resent'; nextResendAllowedAt: string }>('/admin/forgot/resend-otp', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const getMe = async () =>
  request<{ adminId: number; role: string }>('/admin/me', {
    method: 'GET',
  });

export const logout = async () =>
  request<{ status: 'ok' }>('/admin/logout', {
    method: 'POST',
  });
