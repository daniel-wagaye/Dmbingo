import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { approveDeposit, fetchDeposits, rejectDeposit } from '../../services/depositService';

type DepositRow = {
  deposit_id: number;
  telegram_id: number | null;
  first_name: string | null;
  amount: string;
  bank: string | null;
  txn_reference: string | null;
  status: string;
  created_at: string;
  processed_at: string | null;
};

const formatNumber = (value: string | number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0));

const Deposits = () => {
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [selectedDeposit, setSelectedDeposit] = useState<DepositRow | null>(null);
  const [actionPassword, setActionPassword] = useState('');
  const [reason, setReason] = useState('');
  const [approveTelegramId, setApproveTelegramId] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadDeposits = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchDeposits({ page: nextPage });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load deposits';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeposits(1);
  }, []);

  const openReject = (deposit: DepositRow) => {
    setSelectedDeposit(deposit);
    setActionPassword('');
    setReason('');
    setRejectOpen(true);
  };

  const openApprove = (deposit: DepositRow) => {
    setSelectedDeposit(deposit);
    setActionPassword('');
    setReason('');
    setApproveTelegramId('');
    setApproveOpen(true);
  };

  const closeModals = () => {
    setRejectOpen(false);
    setApproveOpen(false);
  };

  const submitReject = async () => {
    if (!selectedDeposit) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    if (!reason.trim()) {
      toast.error('Enter rejection reason.');
      return;
    }
    setActionLoading(true);
    try {
      await rejectDeposit({
        depositId: selectedDeposit.deposit_id,
        actionPassword,
        reason: reason.trim(),
      });
      toast.success('Deposit rejected.');
      closeModals();
      loadDeposits(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reject failed';
      toast.error(
        message === 'invalid_action_password' ? 'Incorrect action password.' : message
      );
    } finally {
      setActionLoading(false);
    }
  };

  const submitApprove = async () => {
    if (!selectedDeposit) return;
    const telegramValue = Number(approveTelegramId);
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    if (!telegramValue) {
      toast.error('Enter a valid telegram id.');
      return;
    }
    if (!reason.trim()) {
      toast.error('Enter approval reason.');
      return;
    }
    setActionLoading(true);
    try {
      await approveDeposit({
        depositId: selectedDeposit.deposit_id,
        telegramId: telegramValue,
        actionPassword,
        reason: reason.trim(),
      });
      toast.success('Deposit approved.');
      closeModals();
      loadDeposits(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approve failed';
      toast.error(
        message === 'invalid_action_password' ? 'Incorrect action password.' : message
      );
    } finally {
      setActionLoading(false);
    }
  };

  const statusBadge = (status: string) => status.toLowerCase();

  return (
    <div className="deposits-page">
      <div className="deposits-header">
        <div>
          <h1>Deposits</h1>
          <p className="deposits-subtitle">Manual deposit approvals</p>
        </div>
      </div>

      <div className="deposits-table-wrapper">
        <table className="deposits-table">
          <thead>
            <tr>
              <th>Deposit ID</th>
              <th>Telegram ID</th>
              <th>First Name</th>
              <th>Amount</th>
              <th>Bank</th>
              <th>Txn Reference</th>
              <th>Status</th>
              <th>Created At</th>
              <th>Processed At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="deposits-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="deposits-empty">
                  No deposits found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const pending = row.status?.toLowerCase() === 'pending';
                return (
                  <tr key={row.deposit_id}>
                    <td>{row.deposit_id}</td>
                    <td>{row.telegram_id ?? '-'}</td>
                    <td>{row.first_name ?? '-'}</td>
                    <td>{formatNumber(row.amount)}</td>
                    <td>{row.bank ?? '-'}</td>
                    <td>{row.txn_reference ?? '-'}</td>
                    <td className={`status-pill ${statusBadge(row.status)}`}>{row.status}</td>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td>{row.processed_at ? new Date(row.processed_at).toLocaleString() : '-'}</td>
                    <td>
                      <div className="action-stack">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => openReject(row)}
                          disabled={!pending}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => openApprove(row)}
                          disabled={!pending}
                        >
                          Approve
                        </button>
                      </div>
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
          onClick={() => loadDeposits(Math.max(page - 1, 1))}
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
          onClick={() => loadDeposits(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      {rejectOpen && selectedDeposit ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Reject Deposit</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="rejectPassword">Action Password</label>
                <input
                  id="rejectPassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="rejectReason">Reason</label>
                <textarea
                  id="rejectReason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
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
                onClick={submitReject}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {approveOpen && selectedDeposit ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Approve Deposit</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="approvePassword">Action Password</label>
                <input
                  id="approvePassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="approveTelegram">User Telegram ID</label>
                <textarea
                  id="approveTelegram"
                  value={approveTelegramId}
                  onChange={(event) => setApproveTelegramId(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="approveReason">Reason</label>
                <textarea
                  id="approveReason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
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
    </div>
  );
};

export default Deposits;
