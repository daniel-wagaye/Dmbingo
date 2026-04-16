const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

type WithdrawalRow = {
  withdrawal_id: number;
  telegram_id: number;
  first_name: string | null;
  amount: string;
  bank: string;
  account_holder: string | null;
  account_num: string | null;
  status: string;
  declined_reason: string | null;
  created_at: string;
  processed_at: string | null;
};

type WithdrawalsResponse = {
  data: WithdrawalRow[];
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

export const fetchWithdrawals = async (params: {
  page?: number;
  status?: 'pending' | 'history';
  search?: string;
  startDate?: string;
  endDate?: string;
}) => {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.status) query.set('status', params.status === 'pending' ? 'pending' : 'history');
  if (params.search) query.set('search', params.search);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  const queryString = query.toString();
  return request<WithdrawalsResponse>(
    `/admin/withdrawals${queryString ? `?${queryString}` : ''}`,
    { method: 'GET' }
  );
};

export const approveWithdrawal = async (payload: {
  withdrawalId: number;
  actionPassword: string;
  adminTxNumber: string;
}) =>
  request<{ status: 'ok' }>('/admin/withdrawals/approve', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const declineWithdrawal = async (payload: {
  withdrawalId: number;
  actionPassword: string;
  reason: 'incorrect' | 'bank';
  reasonNote?: string;
}) =>
  request<{ status: 'ok' }>('/admin/withdrawals/decline', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
