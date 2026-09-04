const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

type UserRow = {
  telegram_id: number;
  first_name: string | null;
  phone_number: string | null;
  username: string | null;
  withdrawal_wallet: string;
  non_withdrawal_wallet: string;
  referral_count: number;
  created_at: string;
};

type UsersResponse = {
  data: UserRow[];
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

export const fetchUsers = async (params: {
  search?: string;
  page?: number;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);
  return request<UsersResponse>(`/admin/users?${query.toString()}`, { method: 'GET' });
};

export type UserDetail = {
  telegram_id: number;
  first_name: string | null;
  phone_number: string | null;
  username: string | null;
  withdrawal_wallet: string;
  non_withdrawal_wallet: string;
  referral_count: number;
  last_referred_date: string | null;
  language: string;
  created_at: string;
};

export const fetchUserByTelegramId = async (telegramId: number) =>
  request<UserDetail>(`/admin/users/${telegramId}`, { method: 'GET' });

export const creditUser = async (payload: {
  telegramId: number;
  amount: number;
  wallet: 'withdrawal' | 'non_withdrawal';
  actionPassword: string;
}) =>
  request<{ status: 'ok'; user: UserRow }>('/admin/credit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const sendUserMessage = async (payload: {
  telegramId: number;
  text: string;
  actionPassword: string;
  imageBase64?: string;
}) =>
  request<{ status: 'ok' }>('/admin/users/message', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
