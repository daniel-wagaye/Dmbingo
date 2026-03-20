import '../telegram/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function getInitData(): string {
  return window.Telegram?.WebApp?.initData || '';
}

interface FetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiClient<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': getInitData(),
    ...headers,
  };

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) {
    return {} as T;
  }

  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Request failed') as Error & {
      status: number;
      data: unknown;
    };
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data as T;
}