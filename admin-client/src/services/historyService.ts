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

const buildQuery = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    query.set(key, String(value));
  });
  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
};

export type TransferHistoryRow = {
  transfer_id: number;
  sender_id: number | null;
  receiver_id: number | null;
  wallet: string | null;
  amount: string;
  commission: string;
  total_amount: string;
  created_at: string;
  sender_phone: string | null;
  receiver_phone: string | null;
};

export type ReferralHistoryRow = {
  referral_id: number;
  referrer_id: number | null;
  referred_user_id: number | null;
  rewarded: boolean;
  rewarded_amount: string | null;
  created_at: string;
};

export type AdminCreditHistoryRow = {
  credit_id: number;
  amount: string;
  action: string;
  credited_wallet: string | null;
  telegram_id: number | null;
  created_at: string;
};

export type AdminActionRow = {
  action_id: number;
  admin_id: number | null;
  admin_username: string | null;
  action_type: string;
  target_type: string | null;
  target_id: number | null;
  payload: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

type HistoryResponse<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const fetchTransferHistory = async (params: {
  page?: number;
  search?: string;
  wallet?: string;
  startDate?: string;
  endDate?: string;
}) =>
  request<HistoryResponse<TransferHistoryRow>>(`/admin/transfers${buildQuery(params)}`, {
    method: 'GET',
  });

export const fetchReferralHistory = async (params: {
  page?: number;
  search?: string;
  rewarded?: string;
  startDate?: string;
  endDate?: string;
}) =>
  request<HistoryResponse<ReferralHistoryRow>>(`/admin/referrals${buildQuery(params)}`, {
    method: 'GET',
  });

export const fetchAdminCreditHistory = async (params: {
  page?: number;
  search?: string;
  actionType?: string;
  wallet?: string;
  minAmount?: string;
  maxAmount?: string;
  startDate?: string;
  endDate?: string;
}) =>
  request<HistoryResponse<AdminCreditHistoryRow>>(`/admin/admin-credits${buildQuery(params)}`, {
    method: 'GET',
  });

export const exportAdminCreditHistory = async (params: {
  search?: string;
  actionType?: string;
  wallet?: string;
  minAmount?: string;
  maxAmount?: string;
  startDate?: string;
  endDate?: string;
}) => {
  const response = await fetch(`${API_BASE}/admin/admin-credits/export${buildQuery(params)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Export failed');
  }
  return response.blob();
};

export type WinnerHistoryRow = {
  id: number;
  game_id: number | null;
  telegram_id: number | null;
  first_name: string | null;
  board_id: number | null;
  credited_amount: string | null;
  won_at: string;
};

export const fetchWinnerHistory = async (params: {
  page?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
}) =>
  request<HistoryResponse<WinnerHistoryRow>>(`/admin/winners${buildQuery(params)}`, {
    method: 'GET',
  });

export const exportWinnerHistory = async (params: {
  search?: string;
  startDate?: string;
  endDate?: string;
}) => {
  const response = await fetch(`${API_BASE}/admin/winners/export${buildQuery(params)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Export failed');
  }
  return response.blob();
};

export const fetchAdminActions = async (params: {
  page?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
}) =>
  request<HistoryResponse<AdminActionRow>>(`/admin/reports${buildQuery(params)}`, {
    method: 'GET',
  });
