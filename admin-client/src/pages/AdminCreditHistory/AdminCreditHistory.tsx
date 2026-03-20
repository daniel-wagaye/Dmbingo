import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  AdminCreditHistoryRow,
  exportAdminCreditHistory,
  fetchAdminCreditHistory,
} from '../../services/historyService';

const AdminCreditHistory = () => {
  const [rows, setRows] = useState<AdminCreditHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [actionType, setActionType] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadCredits = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchAdminCreditHistory({
        page: nextPage,
        search: search.trim() || undefined,
        actionType: actionType || undefined,
        minAmount: minAmount || undefined,
        maxAmount: maxAmount || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load admin credits';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCredits(1);
  }, []);

  const handleExport = async () => {
    if (!startDate || !endDate) {
      toast.error('Select a date range before exporting');
      return;
    }
    setExporting(true);
    try {
      const blob = await exportAdminCreditHistory({
        search: search.trim() || undefined,
        actionType: actionType || undefined,
        minAmount: minAmount || undefined,
        maxAmount: maxAmount || undefined,
        startDate,
        endDate,
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `admin-credit-history-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Admin Credit History</h1>
          <p className="coupons-subtitle">Manual credits issued by admins</p>
        </div>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search Telegram ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') loadCredits(1);
          }}
        />
        <div className="coupons-date">
          <label>
            From
            <input
              type="datetime-local"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="datetime-local"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>
        <div className="coupons-sort">
          <label>
            Action
            <select value={actionType} onChange={(event) => setActionType(event.target.value)}>
              <option value="">All</option>
              <option value="credit_user">Credit User</option>
            </select>
          </label>
        </div>
        <div className="coupons-sort">
          <label>
            Min Amount
            <input
              type="number"
              inputMode="decimal"
              value={minAmount}
              onChange={(event) => setMinAmount(event.target.value)}
            />
          </label>
        </div>
        <div className="coupons-sort">
          <label>
            Max Amount
            <input
              type="number"
              inputMode="decimal"
              value={maxAmount}
              onChange={(event) => setMaxAmount(event.target.value)}
            />
          </label>
        </div>
        <button type="button" className="secondary-button" onClick={() => loadCredits(1)} disabled={loading}>
          Apply Filters
        </button>
        <button type="button" className="primary-button" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Telegram ID</th>
              <th>Action</th>
              <th>Wallet</th>
              <th>Amount</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="coupons-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="coupons-empty">
                  No admin credits found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.credit_id}>
                  <td>{row.credit_id}</td>
                  <td>{row.telegram_id ?? '-'}</td>
                  <td>Credit User</td>
                  <td>{row.credited_wallet ?? '-'}</td>
                  <td>{row.amount}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button
          type="button"
          className="secondary-button"
          onClick={() => loadCredits(Math.max(page - 1, 1))}
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
          onClick={() => loadCredits(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default AdminCreditHistory;
