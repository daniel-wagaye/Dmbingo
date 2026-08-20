const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

type GameConfig = {
  stake_amount: string;
  picking_countdown_end_time: number;
  minimum_player: number;
  referral_amount: string;
  referral_monthly_limit: number;
  registration_bonus: string;
  last_updated: string;
};

type GameStatus = {
  status: 'active' | 'stopped';
  updated_at: string;
};

type GameConfigResponse = {
  config: GameConfig;
  status: GameStatus;
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

export const fetchGameConfig = async () =>
  request<GameConfigResponse>('/admin/game-config', { method: 'GET' });

export const updateGameConfigField = async (payload: {
  field:
    | 'stake_amount'
    | 'picking_countdown_end_time'
    | 'minimum_player'
    | 'referral_amount'
    | 'referral_monthly_limit'
    | 'registration_bonus';
  value: number;
  actionPassword: string;
}) =>
  request<{ status: 'ok'; value?: number }>('/admin/game-config/update', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const startGameStatus = async (payload: { actionPassword: string }) =>
  request<{ status: 'ok' }>('/admin/game-status/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const stopGameStatus = async (payload: { actionPassword: string }) =>
  request<{ status: 'ok' }>('/admin/game-status/stop', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const wakeUpGame = async () =>
  request<{ status: 'ok' }>('/admin/game-control/start', {
    method: 'POST',
  });

export type LeaderboardSnapshotResponse = {
  status: 'ok' | 'partial_failure';
  changed: boolean;
  lines: string[];
  results: Array<{
    period: 'daily' | 'weekly' | 'monthly';
    period_start: string | null;
    rows_saved: number;
    updated: boolean;
    ok: boolean;
  }>;
};

export const updateLeaderboardSnapshots = async () =>
  request<LeaderboardSnapshotResponse>('/admin/leaderboard-snapshots/update', {
    method: 'POST',
  });
