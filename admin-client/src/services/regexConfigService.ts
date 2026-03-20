const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

export type RegexConfigRow = {
  id: number;
  bank_name: string;
  regex_json: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type RegexConfigsResponse = {
  data: RegexConfigRow[];
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

export const fetchRegexConfigs = async (params: { page?: number; search?: string }) => {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return request<RegexConfigsResponse>(`/admin/regex${queryString ? `?${queryString}` : ''}`, {
    method: 'GET',
  });
};

export const createRegexConfig = async (payload: {
  bank_name: string;
  regex_json: string;
  is_active: boolean;
  action_password: string;
}) =>
  request<{ status: 'ok' }>('/admin/regex', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateRegexConfig = async (
  regexId: number,
  payload: {
    bank_name: string;
    regex_json: string;
    is_active: boolean;
    action_password: string;
  }
) =>
  request<{ status: 'ok' }>(`/admin/regex/${regexId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const deleteRegexConfig = async (regexId: number, payload: { action_password: string }) =>
  request<{ status: 'ok' }>(`/admin/regex/${regexId}`, {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });

export const wakeupRegexAcceptor = async () =>
  request<{ status: 'ok' }>('/admin/regex/wakeup', {
    method: 'POST',
  });
