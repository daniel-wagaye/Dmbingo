const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

export type GameRow = {
  game_id: number;
  phase: string | null;
  active_players: number | null;
  minimum_player: number | null;
  stake_amount: string | number | null;
  prize_amount: string | number | null;
  house_profit: string | number | null;
  real_p: number | null;
};

type GamesResponse = {
  data: GameRow[];
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
    throw new Error(error.message ?? error.error ?? 'Request failed');
  }
  return data;
};

export const fetchGames = async (params: {
  page?: number;
  search?: string;
  phase?: string;
  startDate?: string;
  endDate?: string;
}) => {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.search) query.set('search', params.search);
  if (params.phase) query.set('phase', params.phase);
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  return request<GamesResponse>(`/admin/games?${query.toString()}`, { method: 'GET' });
};
