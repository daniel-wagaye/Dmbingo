const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

export type BankRow = {
  id: number;
  bank_name: string;
  account_number: string;
  account_holder_name: string;
  created_at: string;
  updated_at: string;
};

type BanksResponse = {
  data: BankRow[];
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

export const fetchBanks = async (params: { page?: number; search?: string }) => {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return request<BanksResponse>(`/admin/banks${queryString ? `?${queryString}` : ''}`, {
    method: 'GET',
  });
};

export const createBank = async (payload: {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  actionPassword: string;
}) =>
  request<{ status: 'ok'; bank: BankRow }>('/admin/banks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateBank = async (
  bankId: number,
  payload: {
    bankName: string;
    accountNumber: string;
    accountHolderName: string;
    actionPassword: string;
  }
) =>
  request<{ status: 'ok'; bank: BankRow }>(`/admin/banks/${bankId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const deleteBank = async (bankId: number, payload: { actionPassword: string }) =>
  request<{ status: 'ok' }>(`/admin/banks/${bankId}`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
