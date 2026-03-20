const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

export type CouponRow = {
  coupon_id: number;
  coupon_code: string;
  coupon_prize: string;
  credit_wallet: 'withdrawal' | 'non_withdrawal';
  max_uses_total: number;
  current_uses: number;
  starts_at: string;
  expires_at: string;
  status: 'active' | 'expired' | 'finished';
  created_at: string;
  created_by: string | null;
};

export type CouponHistoryRow = {
  claimed_id: number;
  coupon_code: string | null;
  coupon_id: number | null;
  user_telegram_id: number | null;
  claimed_at: string;
  coupon_prize: string | null;
  credited_amount: string | null;
  credit_wallet: string | null;
};

type CouponsResponse = {
  data: CouponRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type CouponHistoryResponse = {
  data: CouponHistoryRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

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

const buildQuery = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    query.set(key, String(value));
  });
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
};

export const fetchCoupons = async (params: {
  page?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
}) =>
  request<CouponsResponse>(`/admin/coupons${buildQuery(params)}`, {
    method: 'GET',
  });

export const createCoupon = async (payload: {
  coupon_code: string;
  coupon_prize: number;
  max_uses_total: number;
  starts_at: string;
  expires_at: string;
  credit_wallet: 'withdrawal' | 'non_withdrawal';
  admin_password: string;
}) =>
  request<{ status: 'ok' }>('/admin/coupons', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const finishCoupon = async (couponId: number, payload: { admin_password: string }) =>
  request<{ status: 'ok' }>(`/admin/coupons/${couponId}/finish`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const exportCoupons = async (params: {
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
}) => {
  const response = await fetch(`${API_BASE}/admin/coupons/export${buildQuery(params)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Export failed');
  }
  return response.blob();
};

export const fetchCouponHistory = async (params: {
  page?: number;
  search?: string;
  telegramId?: string;
  startDate?: string;
  endDate?: string;
}) =>
  request<CouponHistoryResponse>(`/admin/coupons/history${buildQuery(params)}`, {
    method: 'GET',
  });

export const exportCouponHistory = async (params: {
  search?: string;
  telegramId?: string;
  startDate?: string;
  endDate?: string;
}) => {
  const response = await fetch(`${API_BASE}/admin/coupons/history/export${buildQuery(params)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Export failed');
  }
  return response.blob();
};
