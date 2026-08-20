import { apiClient } from './apiClient';

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly';

export interface LeaderboardEntry {
  telegram_id: number;
  first_name: string | null;
  phone_masked: string | null;
  wins_count: number;
  /** Assigned by the backend. Ties share a rank; never derive it from the array index. */
  rank: number | null;
  is_mine: boolean;
}

export interface LeaderboardResponse {
  success: boolean;
  period: LeaderboardPeriod;
  period_start: string | null;
  period_end: string | null;
  rows: LeaderboardEntry[];
  /** Only set when the viewer is outside the top 10; their rank is shown as "NA". */
  viewer: LeaderboardEntry | null;
}

export interface LeaderboardHistoryGroup {
  period_start: string;
  period_end: string | null;
  rows: Array<Omit<LeaderboardEntry, 'is_mine'>>;
}

export interface LeaderboardHistoryResponse {
  success: boolean;
  period: LeaderboardPeriod;
  groups: LeaderboardHistoryGroup[];
  next_cursor: string | null;
  has_more: boolean;
}

// ── Five-minute local storage cache ──
// Current data and each history page are stored under their own key so they can never
// overwrite one another, and nothing is served past its expiry.
const CACHE_PREFIX = 'leaderboard_cache:';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  saved_at: number;
  expires_at: number;
}

const currentKey = (period: LeaderboardPeriod) => `${CACHE_PREFIX}current:${period}`;
const historyKey = (period: LeaderboardPeriod, cursor: string | null) =>
  `${CACHE_PREFIX}history:${period}:${cursor ?? 'first'}`;

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (!entry || typeof entry.expires_at !== 'number' || Date.now() >= entry.expires_at) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    const now = Date.now();
    const entry: CacheEntry<T> = { data, saved_at: now, expires_at: now + CACHE_TTL_MS };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* storage full or unavailable — the request simply repeats next time */
  }
}

/** Drops every cached page of a period, used when its window rolls over. */
export function clearLeaderboardCache(period: LeaderboardPeriod): void {
  try {
    const prefixes = [currentKey(period), `${CACHE_PREFIX}history:${period}:`];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && prefixes.some((p) => key.startsWith(p))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

export async function fetchLeaderboard(period: LeaderboardPeriod): Promise<LeaderboardResponse> {
  const key = currentKey(period);
  const cached = readCache<LeaderboardResponse>(key);
  if (cached) return cached;

  const res = await apiClient<LeaderboardResponse>('/api/leaderboard', {
    method: 'POST',
    body: { period },
  });
  writeCache(key, res);
  return res;
}

export async function fetchLeaderboardHistory(
  period: LeaderboardPeriod,
  cursor: string | null
): Promise<LeaderboardHistoryResponse> {
  const key = historyKey(period, cursor);
  const cached = readCache<LeaderboardHistoryResponse>(key);
  if (cached) return cached;

  const res = await apiClient<LeaderboardHistoryResponse>('/api/leaderboard/history', {
    method: 'POST',
    body: { period, cursor },
  });
  writeCache(key, res);
  return res;
}
