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

export const sendSuperAdminPasswordOtp = async (payload: {
  credentialType: 'login' | 'action';
  email: string;
  newPassword: string;
  confirmPassword: string;
}) =>
  request<{ status: 'otp_sent'; expiresAt: string; nextResendAllowedAt: string }>(
    '/admin/credentials/super/password/send-otp',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

export const updateSuperAdminPassword = async (payload: {
  credentialType: 'login' | 'action';
  email: string;
  newPassword: string;
  confirmPassword: string;
  otp: string;
}) =>
  request<{ status: 'ok' }>('/admin/credentials/super/password/update', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const sendSuperAdminEmailOtp = async (payload: { currentEmail: string; newEmail: string }) =>
  request<{ status: 'otp_sent'; expiresAt: string; nextResendAllowedAt: string }>(
    '/admin/credentials/super/email/send-otp',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

export const updateSuperAdminEmail = async (payload: {
  currentEmail: string;
  newEmail: string;
  currentEmailOtp: string;
  newEmailOtp: string;
}) =>
  request<{ status: 'ok' }>('/admin/credentials/super/email/update', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateWithdrawalAdminPassword = async (payload: {
  credentialType: 'login' | 'action';
  currentActionPassword: string;
  newPassword: string;
  confirmPassword: string;
}) =>
  request<{ status: 'ok' }>('/admin/credentials/withdrawal/password/update', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
