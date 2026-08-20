import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  clearLeaderboardCache,
  fetchLeaderboard,
  fetchLeaderboardHistory,
  LeaderboardEntry,
  LeaderboardHistoryGroup,
  LeaderboardPeriod,
  LeaderboardResponse,
} from '../../services/leaderboardService';
import './Leaderboard.css';

const PERIODS: LeaderboardPeriod[] = ['daily', 'weekly', 'monthly'];

// Africa/Addis_Ababa is fixed at UTC+3 (no DST), matching server boundaries.
const ETH_OFFSET_MS = 3 * 60 * 60 * 1000;

function getNextResetUtcMs(period: LeaderboardPeriod, nowMs: number): number {
  // "Eth wall-clock" expressed as a Date whose UTC components equal Eth-local components.
  const ethNow = new Date(nowMs + ETH_OFFSET_MS);
  let ethReset: Date;
  if (period === 'daily') {
    ethReset = new Date(Date.UTC(
      ethNow.getUTCFullYear(),
      ethNow.getUTCMonth(),
      ethNow.getUTCDate() + 1,
      0, 0, 0, 0,
    ));
  } else if (period === 'weekly') {
    // Postgres date_trunc('week', ...) uses Monday as week start.
    const dow = ethNow.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    let daysToMonday = (8 - dow) % 7;
    if (daysToMonday === 0) daysToMonday = 7;
    ethReset = new Date(Date.UTC(
      ethNow.getUTCFullYear(),
      ethNow.getUTCMonth(),
      ethNow.getUTCDate() + daysToMonday,
      0, 0, 0, 0,
    ));
  } else {
    ethReset = new Date(Date.UTC(
      ethNow.getUTCFullYear(),
      ethNow.getUTCMonth() + 1,
      1,
      0, 0, 0, 0,
    ));
  }
  // Convert Eth wall-clock back to actual UTC.
  return ethReset.getTime() - ETH_OFFSET_MS;
}

function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return '0s';
  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// Period dates arrive as plain YYYY-MM-DD, so they are formatted in UTC to keep the
// calendar day intact regardless of the device timezone.
function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function formatPeriodLabel(
  period: LeaderboardPeriod,
  startIso: string,
  endIso: string | null,
  locale: string,
): string {
  const start = parseIsoDate(startIso);
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };

  if (period === 'monthly') {
    return new Intl.DateTimeFormat(locale, { ...opts, month: 'long', year: 'numeric' }).format(start);
  }
  if (period === 'daily') {
    return new Intl.DateTimeFormat(locale, { ...opts, month: 'long', day: 'numeric', year: 'numeric' }).format(start);
  }

  // Weekly: the stored end is exclusive, so step back a day to show the Sunday.
  const lastDay = endIso ? addDays(parseIsoDate(endIso), -1) : addDays(start, 6);
  const dayMonth = new Intl.DateTimeFormat(locale, { ...opts, month: 'long', day: 'numeric' });
  const year = new Intl.DateTimeFormat(locale, { ...opts, year: 'numeric' });
  return `${dayMonth.format(start)} - ${dayMonth.format(lastDay)}, ${year.format(lastDay)}`;
}

interface LeaderboardModalProps {
  onClose: () => void;
}

interface HistoryState {
  groups: LeaderboardHistoryGroup[];
  nextCursor: string | null;
  hasMore: boolean;
}

const EMPTY_HISTORY: Record<LeaderboardPeriod, HistoryState | null> = {
  daily: null,
  weekly: null,
  monthly: null,
};

function getInitial(name: string | null): string {
  if (!name) return 'P';
  const trimmed = name.trim();
  return (trimmed[0] || 'P').toUpperCase();
}

function TrophyIcon({ rank }: { rank: 1 | 2 | 3 }) {
  const color = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : '#CD7F32';
  return (
    <svg
      className={`leader-trophy leader-trophy-${rank}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={color}
      stroke="rgba(0,0,0,0.35)"
      strokeWidth="0.6"
      aria-hidden="true"
    >
      <path d="M6 4h12v2h2.5a1.5 1.5 0 0 1 1.5 1.5V9a4 4 0 0 1-4 4h-.34A6 6 0 0 1 13 16.92V19h3v2H8v-2h3v-2.08A6 6 0 0 1 6.34 13H6a4 4 0 0 1-4-4V7.5A1.5 1.5 0 0 1 3.5 6H6V4Zm0 4H4v1a2 2 0 0 0 2 2V8Zm12 0v3a2 2 0 0 0 2-2V8h-2Z" />
    </svg>
  );
}

interface LeaderRowProps {
  row: Omit<LeaderboardEntry, 'is_mine'>;
  mine: boolean;
  naRankLabel?: string;
}

function LeaderRow({ row, mine, naRankLabel }: LeaderRowProps) {
  const { t } = useTranslation();
  const rank = row.rank;
  const medal = rank === 1 || rank === 2 || rank === 3 ? (rank as 1 | 2 | 3) : null;
  return (
    <li className={`leader-row ${mine ? 'leader-row-mine' : ''}`}>
      <span className="leader-rank">{rank === null ? naRankLabel : `#${rank}`}</span>
      <div className={`leader-avatar ${medal ? `leader-avatar-rank-${medal}` : ''}`}>
        <span className="leader-avatar-letter">{getInitial(row.first_name)}</span>
        {medal ? <TrophyIcon rank={medal} /> : null}
      </div>
      <div className="leader-info">
        <span className="leader-name">{row.first_name || 'Player'}</span>
        <span className="leader-phone">{row.phone_masked || '****'}</span>
      </div>
      <div className="leader-wins">
        <span className="leader-wins-count">{row.wins_count}</span>
        <span className="leader-wins-label">{t('wins_label')}</span>
      </div>
    </li>
  );
}

export default function LeaderboardModal({ onClose }: LeaderboardModalProps) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<LeaderboardPeriod>('daily');
  const [currentByPeriod, setCurrentByPeriod] = useState<Record<LeaderboardPeriod, LeaderboardResponse | null>>({
    daily: null,
    weekly: null,
    monthly: null,
  });
  const [historyByPeriod, setHistoryByPeriod] = useState<Record<LeaderboardPeriod, HistoryState | null>>(EMPTY_HISTORY);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // 1Hz tick for the countdown.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const resetAtMs = getNextResetUtcMs(period, nowMs);
  const msLeft = Math.max(0, resetAtMs - nowMs);

  // Crossing a boundary makes the shown period stale, so its cache is dropped. The
  // leaderboard never refetches on its own — the user reopens it to see new results.
  const prevMsLeftRef = useRef<number>(msLeft);
  useEffect(() => {
    if (prevMsLeftRef.current > 0 && msLeft === 0) {
      clearLeaderboardCache(period);
    }
    prevMsLeftRef.current = msLeft;
  }, [msLeft, period]);

  const showError = useCallback(
    (err: any) => {
      if (err?.status === 401) {
        toast.error(t('leaderboard_auth_error'));
      } else if (err?.status === 429) {
        toast.error(t('leaderboard_rate_limit'));
      } else {
        toast.error(t('leaderboard_error'));
      }
    },
    [t],
  );

  const loadCurrent = useCallback(
    async (p: LeaderboardPeriod) => {
      setLoading(true);
      try {
        const res = await fetchLeaderboard(p);
        setCurrentByPeriod((prev) => ({ ...prev, [p]: res }));
      } catch (err: any) {
        showError(err);
      } finally {
        setLoading(false);
      }
    },
    [showError],
  );

  const loadHistory = useCallback(
    async (p: LeaderboardPeriod, cursor: string | null) => {
      setHistoryLoading(true);
      try {
        const res = await fetchLeaderboardHistory(p, cursor);
        setHistoryByPeriod((prev) => {
          const existing = cursor === null ? null : prev[p];
          return {
            ...prev,
            [p]: {
              groups: [...(existing?.groups ?? []), ...res.groups],
              nextCursor: res.next_cursor,
              hasMore: res.has_more,
            },
          };
        });
      } catch (err: any) {
        showError(err);
      } finally {
        setHistoryLoading(false);
      }
    },
    [showError],
  );

  // Only the selected tab is loaded; weekly and monthly stay untouched until picked.
  // Each tab is requested once per session, so a failed request shows its toast and
  // stops instead of retrying in a loop.
  const requestedCurrent = useRef<Set<LeaderboardPeriod>>(new Set());
  const requestedHistory = useRef<Set<LeaderboardPeriod>>(new Set());

  useEffect(() => {
    if (requestedCurrent.current.has(period)) return;
    requestedCurrent.current.add(period);
    loadCurrent(period);
  }, [period, loadCurrent]);

  useEffect(() => {
    if (requestedHistory.current.has(period)) return;
    requestedHistory.current.add(period);
    loadHistory(period, null);
  }, [period, loadHistory]);

  const handlePeriodChange = (p: LeaderboardPeriod) => {
    if (loading || p === period) return;
    setPeriod(p);
  };

  const current = currentByPeriod[period];
  const history = historyByPeriod[period];
  const rows = current?.rows ?? [];
  const initialLoading = current === null && loading;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="leaderboard-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="leaderboard-header">
          <h3 className="leaderboard-title">{t('leaderboard_title')}</h3>
          <button className="leaderboard-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Period tabs */}
        <div className="leaderboard-tabs">
          {PERIODS.map((p) => (
            <button
              key={p}
              className={`leaderboard-tab-btn ${period === p ? 'active' : ''}`}
              onClick={() => handlePeriodChange(p)}
              disabled={loading}
            >
              {t(`tab_${p}`)}
            </button>
          ))}
        </div>

        {/* Reset countdown */}
        <div className="leaderboard-countdown" aria-live="polite">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>{t('resets_in_time', { time: formatCountdown(msLeft) })}</span>
        </div>

        {/* Content */}
        <div className="leaderboard-content">
          {initialLoading ? (
            <div className="leaderboard-spinner-wrap"><div className="spinner" /></div>
          ) : (
            <>
              {/* Current period */}
              {rows.length === 0 ? (
                <p className="leaderboard-empty">{t('no_leaders')}</p>
              ) : (
                <ol className="leaderboard-list">
                  {rows.map((row) => (
                    <LeaderRow key={row.telegram_id} row={row} mine={row.is_mine} />
                  ))}
                </ol>
              )}

              {/* Viewer, when there are leaders and they are not among them */}
              {rows.length > 0 && current?.viewer ? (
                <>
                  <div className="leaderboard-divider" role="presentation" />
                  <ol className="leaderboard-list">
                    <LeaderRow row={current.viewer} mine naRankLabel={t('rank_na')} />
                  </ol>
                </>
              ) : null}

              {/* Saved history */}
              <div className="leaderboard-divider leaderboard-divider-section" role="presentation" />
              <h4 className="leaderboard-section-title">{t('leaderboard_history_title')}</h4>

              {history === null && historyLoading ? (
                <div className="leaderboard-spinner-wrap leaderboard-spinner-wrap-sm"><div className="spinner" /></div>
              ) : !history || history.groups.length === 0 ? (
                <p className="leaderboard-empty">{t('leaderboard_no_history')}</p>
              ) : (
                <>
                  {history.groups.map((group) => (
                    <div className="leaderboard-group" key={group.period_start}>
                      <span className="leaderboard-group-label">
                        {formatPeriodLabel(period, group.period_start, group.period_end, i18n.language)}
                      </span>
                      <ol className="leaderboard-list">
                        {group.rows.map((row, idx) => (
                          // Rows of deleted users all report id 0, so the position keeps keys unique.
                          <LeaderRow key={`${group.period_start}-${idx}`} row={row} mine={false} />
                        ))}
                      </ol>
                    </div>
                  ))}

                  {history.hasMore ? (
                    <button
                      className="leaderboard-load-more"
                      onClick={() => loadHistory(period, history.nextCursor)}
                      disabled={historyLoading}
                    >
                      {historyLoading ? <span className="spinner-sm" /> : t('leaderboard_load_more')}
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
