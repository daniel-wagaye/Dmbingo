const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

type AdminRow = {
  admin_id: number;
  role: 'super_admin' | 'withdrawal_admin';
  first_name: string | null;
  last_name: string | null;
  username: string;
  created_at: string;
  is_active: boolean;
};

type AdminListResponse = {
  data: AdminRow[];
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

export const fetchAdmins = async (params: {
  search?: string;
  page?: number;
  sortOrder?: 'asc' | 'desc';
}) => {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);
  return request<AdminListResponse>(`/admin/admins?${query.toString()}`, { method: 'GET' });
};

export const createAdmin = async (payload: {
  role: 'withdrawal_admin';
  username: string;
  firstName: string;
  lastName?: string;
  loginPassword: string;
  actionPassword: string;
  superAdminActionPassword: string;
}) =>
  request<{ status: 'ok'; admin: AdminRow }>('/admin/admins', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateAdmin = async (
  adminId: number,
  payload: {
    editMode: 'username' | 'login_password' | 'action_password' | 'all';
    username?: string;
    loginPassword?: string;
    actionPassword?: string;
    superAdminActionPassword: string;
  }
) =>
  request<{ status: 'ok'; admin: AdminRow }>(`/admin/admins/${adminId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const updateAdminStatus = async (
  adminId: number,
  payload: { isActive: boolean; actionPassword: string }
) =>
  request<{ status: 'ok'; admin: AdminRow }>(`/admin/admins/${adminId}/status`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export type { AdminRow };
