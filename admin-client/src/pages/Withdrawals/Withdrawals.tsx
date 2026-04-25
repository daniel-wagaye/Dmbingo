import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import TelegramIdCell from '../../components/TelegramIdCell';
import UserDetailsModal from '../../components/UserDetailsModal';
import {
  approveWithdrawal,
  declineWithdrawal,
  fetchWithdrawals,
} from '../../services/withdrawalService';

type WithdrawalRow = {
  withdrawal_id: number;
  telegram_id: number;
  first_name: string | null;
  amount: string;
  bank: string;
  account_holder: string | null;
  account_num: string | null;
  status: string;
  declined_reason: string | null;
  declinedReason?: string | null;
  created_at: string;
  processed_at: string | null;
};

type ViewMode = 'pending' | 'history';

const formatNumber = (value: string | number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0));

const truncateReason = (value: string) => {
  if (value.length <= 10) {
    return value;
  }
  return `${value.slice(0, 7)}...`;
};

const getDeclinedReason = (row: WithdrawalRow): string | null => {
  const value = row.declined_reason ?? row.declinedReason ?? null;
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const Withdrawals = ({ mode }: { mode: ViewMode }) => {
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [approveOpen, setApproveOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [selected, setSelected] = useState<WithdrawalRow | null>(null);
  const [actionPassword, setActionPassword] = useState('');
  const [adminTxNumber, setAdminTxNumber] = useState('');
  const [declineReason, setDeclineReason] = useState<'incorrect' | 'bank' | ''>('');
  const [declineReasonNote, setDeclineReasonNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedDeclineId, setExpandedDeclineId] = useState<number | null>(null);
  const declineReasonRef = useRef<HTMLTableCellElement | null>(null);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);

  const columns = useMemo(
    () =>
      [
        { key: 'withdrawal_id', label: 'Withdrawal ID' },
        { key: 'telegram_id', label: 'Telegram ID' },
        { key: 'first_name', label: 'First Name' },
        { key: 'amount', label: 'Amount' },
        { key: 'bank', label: 'Bank' },
        { key: 'account_holder', label: 'Account Holder' },
        { key: 'account_num', label: 'Account Number' },
        { key: 'status', label: 'Status' },
        ...(mode === 'history' ? [{ key: 'declined_reason', label: 'Declined Reason' }] : []),
        { key: 'created_at', label: 'Created At' },
      ] as const,
    [mode]
  );

  const loadWithdrawals = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchWithdrawals({
        page: nextPage,
        status: mode,
        search: search.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load withdrawals';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWithdrawals(1);
  }, [mode]);

  useEffect(() => {
    if (!expandedDeclineId) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (!declineReasonRef.current) {
        return;
      }
      if (declineReasonRef.current.contains(event.target as Node)) {
        return;
      }
      setExpandedDeclineId(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedDeclineId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [expandedDeclineId]);

  const openApprove = (row: WithdrawalRow) => {
    setSelected(row);
    setActionPassword('');
    setAdminTxNumber('');
    setApproveOpen(true);
  };

  const openDecline = (row: WithdrawalRow) => {
    setSelected(row);
    setActionPassword('');
    setDeclineReason('');
    setDeclineReasonNote('');
    setDeclineOpen(true);
  };

  const closeModals = () => {
    setApproveOpen(false);
    setDeclineOpen(false);
  };

  const submitApprove = async () => {
    if (!selected) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    if (adminTxNumber.trim().length < 9 || adminTxNumber.trim().length > 21) {
      toast.error('Admin transaction number must be 9–21 characters.');
      return;
    }
    setActionLoading(true);
    try {
      await approveWithdrawal({
        withdrawalId: selected.withdrawal_id,
        actionPassword,
        adminTxNumber: adminTxNumber.trim(),
      });
      toast.success('Withdrawal approved.');
      closeModals();
      loadWithdrawals(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approve failed';
      toast.error(
        message === 'invalid_action_password' ? 'Incorrect action password.' : message
      );
    } finally {
      setActionLoading(false);
    }
  };

  const submitDecline = async () => {
    if (!selected) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    if (!declineReason) {
      toast.error('Select decline reason.');
      return;
    }
    if (declineReasonNote.trim().length > 200) {
      toast.error('Decline information cannot exceed 200 characters.');
      return;
    }
    setActionLoading(true);
    try {
      await declineWithdrawal({
        withdrawalId: selected.withdrawal_id,
        actionPassword,
        reason: declineReason,
        reasonNote: declineReasonNote.trim(),
      });
      toast.success('Withdrawal declined.');
      closeModals();
      loadWithdrawals(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Decline failed';
      toast.error(
        message === 'invalid_action_password' ? 'Incorrect action password.' : message
      );
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="withdrawals-page">
      <div className="withdrawals-header">
        <div>
          <h1>Withdrawals</h1>
          <p className="withdrawals-subtitle">
            {mode === 'pending' ? 'Pending withdrawals' : 'Approved & declined history'}
          </p>
        </div>
        <div className="withdrawals-tabs">
          <a
            className={`tab-link${mode === 'pending' ? ' active' : ''}`}
            href="/admin/withdrawals/pending"
          >
            Pending
          </a>
          <a
            className={`tab-link${mode === 'history' ? ' active' : ''}`}
            href="/admin/withdrawals/approved"
          >
            Approved
          </a>
        </div>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search Telegram ID, amount, bank, account, or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') loadWithdrawals(1); }}
        />
        <div className="coupons-date">
          <label>
            From
            <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            To
            <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <button type="button" className="secondary-button" onClick={() => loadWithdrawals(1)} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="withdrawals-table-wrapper">
        <table className="withdrawals-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              <th>{mode === 'pending' ? 'Actions' : 'Processed At'}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + 1} className="withdrawals-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="withdrawals-empty">
                  No withdrawals found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const declinedReasonValue = getDeclinedReason(row);
                return (
                  <tr key={row.withdrawal_id}>
                  <td>{row.withdrawal_id}</td>
                  <td><TelegramIdCell telegramId={row.telegram_id} onClick={setDetailId} /></td>
                  <td>{row.first_name ?? '-'}</td>
                  <td>{formatNumber(row.amount)}</td>
                  <td>{row.bank}</td>
                  <td>{row.account_holder ?? '-'}</td>
                  <td>{row.account_num ?? '-'}</td>
                  <td className={`status-pill ${row.status.toLowerCase()}`}>{row.status}</td>
                  {mode === 'history' ? (
                    <td
                      className="decline-reason-cell"
                      ref={expandedDeclineId === row.withdrawal_id ? declineReasonRef : null}
                    >
                      {declinedReasonValue ? (
                        declinedReasonValue.length > 10 ? (
                          <>
                            <button
                              type="button"
                              className="decline-reason-trigger"
                              onClick={() =>
                                setExpandedDeclineId((prev) =>
                                  prev === row.withdrawal_id ? null : row.withdrawal_id
                                )
                              }
                            >
                              {truncateReason(declinedReasonValue)}
                            </button>
                            {expandedDeclineId === row.withdrawal_id ? (
                              <div className="decline-reason-popover">{declinedReasonValue}</div>
                            ) : null}
                          </>
                        ) : (
                          declinedReasonValue
                        )
                      ) : (
                        '-'
                      )}
                    </td>
                  ) : null}
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    {mode === 'pending' ? (
                      <div className="action-stack">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => openDecline(row)}
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => openApprove(row)}
                        >
                          Approve
                        </button>
                      </div>
                    ) : row.processed_at ? (
                      new Date(row.processed_at).toLocaleString()
                    ) : (
                      '-'
                    )}
                  </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button
          type="button"
          className="secondary-button"
          onClick={() => loadWithdrawals(Math.max(page - 1, 1))}
          disabled={page <= 1 || loading}
        >
          Previous
        </button>
        <span className="pagination-info">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="secondary-button"
          onClick={() => loadWithdrawals(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      <UserDetailsModal telegramId={detailId} open={detailId !== null} onClose={() => setDetailId(null)} />

      {approveOpen && selected ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Approve Withdrawal</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="withdrawPassword">Action Password</label>
                <input
                  id="withdrawPassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="adminTxNumber">Admin Tx Number</label>
                <input
                  id="adminTxNumber"
                  type="text"
                  value={adminTxNumber}
                  onChange={(event) => setAdminTxNumber(event.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeModals}>
                Close
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={submitApprove}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {declineOpen && selected ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Decline Withdrawal</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="declinePassword">Action Password</label>
                <input
                  id="declinePassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label>Reason</label>
                <div className="radio-group">
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="declineReason"
                      value="incorrect"
                      checked={declineReason === 'incorrect'}
                      onChange={() => setDeclineReason('incorrect')}
                    />
                    Incorrect
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="declineReason"
                      value="bank"
                      checked={declineReason === 'bank'}
                      onChange={() => setDeclineReason('bank')}
                    />
                    Bank
                  </label>
                </div>
              </div>
              <div className="modal-field">
                <label htmlFor="declineReasonNote">Additional Information</label>
                <textarea
                  id="declineReasonNote"
                  maxLength={200}
                  value={declineReasonNote}
                  onChange={(event) => setDeclineReasonNote(event.target.value)}
                  placeholder="Optional details for the user"
                />
                <small>{declineReasonNote.length}/200</small>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeModals}>
                Close
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={submitDecline}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Withdrawals;
