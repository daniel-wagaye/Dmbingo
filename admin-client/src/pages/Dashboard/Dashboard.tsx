import { useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';

type DashboardSummary = {
  totals: {
    totalPlayers: number;
    totalPlayedGames: number;
    totalDeposits: number;
    totalWithdrawals: number;
    totalTransferCommissionProfit: number;
    totalGameProfit: number;
    totalProfit: number;
  };
  monthly: {
    thisMonthWithdrawals: number;
    thisMonthDeposits: number;
    thisMonthProfit: number;
    pendingWithdrawals: number;
  };
};

type StatCard = {
  label: string;
  value: number;
  statKey?: StatKey;
};

type StatKey =
  | 'total_players'
  | 'total_games'
  | 'total_deposits'
  | 'total_withdrawals'
  | 'total_transfer_commission_profit'
  | 'total_game_profit'
  | 'total_profit';

const API_BASE = import.meta.env.VITE_ADMIN_API_URL ?? 'http://localhost:4000';

const toFiniteNumber = (value: unknown) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

const defaultSummary: DashboardSummary = {
  totals: {
    totalPlayers: 0,
    totalPlayedGames: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalTransferCommissionProfit: 0,
    totalGameProfit: 0,
    totalProfit: 0,
  },
  monthly: {
    thisMonthWithdrawals: 0,
    thisMonthDeposits: 0,
    thisMonthProfit: 0,
    pendingWithdrawals: 0,
  },
};

const coerceSummary = (data: unknown): DashboardSummary => {
  const source = (data ?? {}) as Record<string, unknown>;
  const totals = (source.totals ?? {}) as Record<string, unknown>;
  const monthly = (source.monthly ?? {}) as Record<string, unknown>;
  return {
    totals: {
      totalPlayers: toFiniteNumber(totals.totalPlayers),
      totalPlayedGames: toFiniteNumber(totals.totalPlayedGames),
      totalDeposits: toFiniteNumber(totals.totalDeposits),
      totalWithdrawals: toFiniteNumber(totals.totalWithdrawals),
      totalTransferCommissionProfit: toFiniteNumber(totals.totalTransferCommissionProfit),
      totalGameProfit: toFiniteNumber(totals.totalGameProfit ?? totals.total_game_profit),
      totalProfit: toFiniteNumber(totals.totalProfit),
    },
    monthly: {
      thisMonthWithdrawals: toFiniteNumber(monthly.thisMonthWithdrawals),
      thisMonthDeposits: toFiniteNumber(monthly.thisMonthDeposits),
      thisMonthProfit: toFiniteNumber(monthly.thisMonthProfit),
      pendingWithdrawals: toFiniteNumber(monthly.pendingWithdrawals),
    },
  };
};

const fetchSummary = async () => {
  const response = await fetch(`${API_BASE}/admin/stats/summary`, {
    credentials: 'include',
  });
  const data = (await response.json().catch(() => ({}))) as DashboardSummary & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? 'Failed to load dashboard');
  }
  return coerceSummary(data);
};

const fetchFilteredStat = async (statKey: StatKey, startDate: string, endDate: string) => {
  const params = new URLSearchParams({
    startDate,
    endDate,
  });
  const response = await fetch(`${API_BASE}/admin/stats/${statKey}?${params.toString()}`, {
    credentials: 'include',
  });
  const data = (await response.json().catch(() => ({}))) as { value?: number; error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? 'Failed to load filtered stat');
  }
  return toFiniteNumber(data.value);
};

type ModalState = {
  open: boolean;
  statKey: StatKey | null;
  title: string;
  originalValue: number;
  updateCardOnSuccess: boolean;
};

const Dashboard = () => {
  const [summary, setSummary] = useState<DashboardSummary>(defaultSummary);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<ModalState>({
    open: false,
    statKey: null,
    title: '',
    originalValue: 0,
    updateCardOnSuccess: true,
  });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [resultValue, setResultValue] = useState(0);
  const [resultStatus, setResultStatus] = useState('');
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState('');
  const [isFiltered, setIsFiltered] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchSummary()
      .then((data) => {
        setSummary(data);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to load dashboard');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!modal.open) return;
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable?.[0];
    first?.focus();
  }, [modal.open]);

  useEffect(() => {
    if (!modal.open) return;
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [modal.open]);

  const statCards: StatCard[] = useMemo(
    () => [
      { label: 'Total Players', value: summary.totals.totalPlayers, statKey: 'total_players' },
      { label: 'Total Played Games', value: summary.totals.totalPlayedGames, statKey: 'total_games' },
      { label: 'Total Deposits', value: summary.totals.totalDeposits, statKey: 'total_deposits' },
      { label: 'Total Withdraw', value: summary.totals.totalWithdrawals, statKey: 'total_withdrawals' },
      {
        label: 'Total Transfer Commission Profit',
        value: summary.totals.totalTransferCommissionProfit,
        statKey: 'total_transfer_commission_profit',
      },
      {
        label: 'Tootal Game Profit',
        value: summary.totals.totalGameProfit,
        statKey: 'total_game_profit',
      },
      { label: 'Total Profit', value: summary.totals.totalProfit, statKey: 'total_profit' },
    ],
    [summary]
  );

  const monthlyCards: StatCard[] = useMemo(
    () => [
      { label: 'This Month Withdrawal Amount', value: summary.monthly.thisMonthWithdrawals },
      { label: 'This Month Deposits', value: summary.monthly.thisMonthDeposits },
      { label: 'This Month Profit', value: summary.monthly.thisMonthProfit },
      { label: 'Pending Withdrawals', value: summary.monthly.pendingWithdrawals },
    ],
    [summary]
  );

  const openModal = (card: StatCard) => {
    if (!card.statKey) return;
    setModal({
      open: true,
      statKey: card.statKey,
      title: card.label,
      originalValue: card.value,
      updateCardOnSuccess: true,
    });
    setStartDate('');
    setEndDate('');
    setResultValue(card.value);
    setResultStatus('');
    setResultError('');
    setIsFiltered(false);
  };

  const closeModal = () => {
    setModal((prev) => ({ ...prev, open: false }));
  };

  const handleApply = async () => {
    if (!modal.statKey) return;
    if (!startDate || !endDate) {
      setResultError('Please select start and end dates.');
      return;
    }
    if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
      setResultError('End date must be after start date.');
      return;
    }
    setResultError('');
    setResultStatus('Loading...');
    setResultLoading(true);
    try {
      const value = await fetchFilteredStat(modal.statKey, startDate, endDate);
      setResultValue(value);
      setResultStatus('Filtered');
      setIsFiltered(true);
      if (modal.updateCardOnSuccess) {
        setSummary((prev) => {
          const updated = { ...prev };
          switch (modal.statKey) {
            case 'total_players':
              updated.totals.totalPlayers = value;
              break;
            case 'total_games':
              updated.totals.totalPlayedGames = value;
              break;
            case 'total_deposits':
              updated.totals.totalDeposits = value;
              break;
            case 'total_withdrawals':
              updated.totals.totalWithdrawals = value;
              break;
            case 'total_transfer_commission_profit':
              updated.totals.totalTransferCommissionProfit = value;
              break;
            case 'total_game_profit':
              updated.totals.totalGameProfit = value;
              break;
            case 'total_profit':
              updated.totals.totalProfit = value;
              break;
          }
          return updated;
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load filtered stat';
      setResultError(message);
      toast.error(message);
    } finally {
      setResultLoading(false);
    }
  };

  const handleClear = () => {
    setResultValue(modal.originalValue);
    setResultStatus('');
    setResultError('');
    setIsFiltered(false);
  };

  const handleRetry = () => {
    handleApply();
  };

  return (
    <div className="dashboard-page">
      <Toaster position="top-right" />
      <div className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p className="dashboard-subtitle">High-level performance overview</p>
        </div>
        <div className="dashboard-status">
          {loading ? <span className="dashboard-pill">Loading...</span> : null}
        </div>
      </div>

      <section className="dashboard-section">
        <h2>Monthly Overview</h2>
        <div className="card-grid">
          {monthlyCards.map((card) => (
            <div key={card.label} className="stat-card">
              <div className="stat-label">{card.label}</div>
              <div className="stat-value">{formatNumber(card.value)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-section">
        <h2>Totals</h2>
        <div className="card-grid">
          {statCards.map((card) => (
            <button
              key={card.label}
              className="stat-card clickable"
              type="button"
              onClick={() => openModal(card)}
            >
              <div className="stat-label">{card.label}</div>
              <div className="stat-value">{formatNumber(card.value)}</div>
            </button>
          ))}
        </div>
      </section>

      {modal.open ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" ref={modalRef}>
            <div className="modal-header">
              <h3>{modal.title}</h3>
              <button type="button" className="icon-button" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-value">
                <span className="modal-number">{formatNumber(resultValue)}</span>
                {isFiltered ? <span className="modal-tag">(Filtered)</span> : null}
              </div>
              <div className="modal-status">
                {resultLoading ? <span className="spinner" /> : null}
                <span>{resultStatus}</span>
              </div>
              {resultError ? <div className="modal-error">{resultError}</div> : null}

              <div className="modal-field">
                <label htmlFor="startDate">Start Date</label>
                <input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="endDate">End Date</label>
                <input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={handleClear}>
                Clear
              </button>
              {resultError ? (
                <button type="button" className="secondary-button" onClick={handleRetry}>
                  Retry
                </button>
              ) : null}
              <button type="button" className="primary-button" onClick={handleApply}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Dashboard;
