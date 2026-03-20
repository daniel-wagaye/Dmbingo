import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { fetchHistory, HistoryRow } from '../../services/historyService';
import './History.css';

const FILTERS = ['all', 'win', 'withdraw', 'transfer', 'coupon'] as const;
const PAGE_SIZE = 100;

interface HistoryModalProps {
  onClose: () => void;
}

function maskAccountNum(num: string | null | undefined): string {
  if (!num) return '—';
  if (num.length <= 4) return num;
  return '******' + num.slice(-4);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function HistoryModal({ onClose }: HistoryModalProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<string>('all');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [revealedAccounts, setRevealedAccounts] = useState<Set<number>>(new Set());

  const loadData = useCallback(async (f: string, c: string | null, append: boolean) => {
    setLoading(true);
    try {
      const res = await fetchHistory(f, PAGE_SIZE, c);
      if (append) {
        setRows(prev => [...prev, ...res.rows]);
      } else {
        setRows(res.rows);
      }
      setCursor(res.next_cursor);
      setHasMore(res.rows.length === PAGE_SIZE && res.next_cursor !== null);
      setInitialLoaded(true);
    } catch (err: any) {
      if (err.status === 401) {
        toast.error(t('history_auth_error'));
      } else if (err.status === 429) {
        toast.error(t('history_rate_limit'));
      } else {
        toast.error(t('history_error'));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Initial load on mount
  useState(() => {
    loadData('all', null, false);
  });

  const handleFilterChange = (f: string) => {
    if (loading || f === filter) return;
    setFilter(f);
    setRows([]);
    setCursor(null);
    setHasMore(true);
    setRevealedAccounts(new Set());
    loadData(f, null, false);
  };

  const handleLoadMore = () => {
    if (loading || !hasMore) return;
    loadData(filter, cursor, true);
  };

  const toggleReveal = (idx: number) => {
    setRevealedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const getStatusColor = (status: string | null | undefined): string => {
    if (status === 'pending') return '#F5C94A';
    if (status === 'approved') return '#34D399';
    if (status === 'declined') return '#F87171';
    return '#8a94a6';
  };

  const getStatusText = (status: string | null | undefined): string => {
    if (status === 'pending') return t('status_pending');
    if (status === 'approved') return t('status_approved');
    if (status === 'declined') return t('status_declined');
    return '';
  };

  const getWalletLabel = (wallet: string | null | undefined): string => {
    if (wallet === 'withdrawal') return t('withdrawal_wallet_label');
    return t('playing_wallet_label');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="history-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="history-header">
          <h3 className="history-title">{t('history_title')}</h3>
          <button className="history-close" onClick={onClose}>✕</button>
        </div>

        {/* Filter tabs */}
        <div className="history-filters">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`history-filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => handleFilterChange(f)}
              disabled={loading}
            >
              {t(`filter_${f}`)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="history-content">
          {!initialLoaded && loading ? (
            <div className="history-spinner-wrap"><div className="spinner" /></div>
          ) : rows.length === 0 ? (
            <p className="history-empty">{t('no_history')}</p>
          ) : (
            <>
              {rows.map((row, idx) => (
                <div key={idx} className={`history-card history-card-${row.type}`}>
                  <div className="history-card-top">
                    <span className="history-card-title">{row.title}</span>
                    {row.type === 'withdraw' && row.status && (
                      <span
                        className="history-status-badge"
                        style={{ color: getStatusColor(row.status), borderColor: getStatusColor(row.status) }}
                      >
                        {getStatusText(row.status)}
                      </span>
                    )}
                  </div>

                  <div className="history-card-amount">
                    {row.amount} {row.currency}
                  </div>

                  {/* Withdraw details */}
                  {row.type === 'withdraw' && (
                    <div className="history-card-details">
                      {row.bank && <span>🏦 {row.bank}</span>}
                      {row.account_num && (
                        <span className="history-account-row">
                          {revealedAccounts.has(idx) ? row.account_num : maskAccountNum(row.account_num)}
                          <button className="history-reveal-btn" onClick={() => toggleReveal(idx)}>
                            {revealedAccounts.has(idx) ? t('hide') : t('show')}
                          </button>
                        </span>
                      )}
                      {row.account_holder_name && <span>{row.account_holder_name}</span>}
                    </div>
                  )}

                  {/* Transfer details */}
                  {row.type === 'transfer' && (
                    <div className="history-card-details">
                      {row.direction && <span>{row.direction === 'sent' ? '↗' : '↙'} {row.direction}</span>}
                      {row.wallet && <span>{getWalletLabel(row.wallet)}</span>}
                      {row.commission && Number(row.commission) > 0 && <span>Fee: {row.commission}</span>}
                    </div>
                  )}

                  {/* Coupon details */}
                  {row.type === 'coupon' && row.credit_wallet && (
                    <div className="history-card-details">
                      <span>{getWalletLabel(row.credit_wallet)}</span>
                    </div>
                  )}

                  <div className="history-card-date">{formatDate(row.created_at)}</div>
                </div>
              ))}

              {/* Load more */}
              {hasMore && (
                <button
                  className="history-load-more"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  {loading ? <span className="spinner-sm" /> : t('load_more')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}