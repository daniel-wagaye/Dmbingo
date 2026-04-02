const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

type DepositRow = {
  deposit_id: number;
  telegram_id: number | null;
  first_name: string | null;
  amount: string;
  bank: string | null;
  txn_reference: string | null;
  status: string;
  created_at: string;
  processed_at: string | null;
};

type DepositsResponse = {
  data: DepositRow[];
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

export const fetchDeposits = async (params: { page?: number }) => {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  const queryString = query.toString();
  return request<DepositsResponse>(`/admin/deposits${queryString ? `?${queryString}` : ''}`, {
    method: 'GET',
  });
};

export const rejectDeposit = async (payload: {
  depositId: number;
  actionPassword: string;
  reason: string;
}) =>
  request<{ status: 'ok' }>('/admin/deposits/reject', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const approveDeposit = async (payload: {
  depositId: number;
  telegramId: number;
  actionPassword: string;
  reason: string;
}) =>
  request<{ status: 'ok' }>('/admin/deposits/approve', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const createDeposit = async (payload: {
  actionPassword: string;
  bank: string;
  amount: number;
  txnReference: string;
}) =>
  request<{ status: 'ok'; depositId: number }>('/admin/deposits/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
