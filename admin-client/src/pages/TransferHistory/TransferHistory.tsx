import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { fetchTransferHistory, TransferHistoryRow } from '../../services/historyService';

const TransferHistory = () => {
  const [rows, setRows] = useState<TransferHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [wallet, setWallet] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selected, setSelected] = useState<TransferHistoryRow | null>(null);

  const loadTransfers = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchTransferHistory({
        page: nextPage,
        search: search.trim() || undefined,
        wallet: wallet || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load transfers';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransfers(1);
  }, []);

  const closeDrawer = () => setSelected(null);

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Transfer History</h1>
          <p className="coupons-subtitle">Read-only transfer logs</p>
        </div>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search sender/receiver ID or phone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') loadTransfers(1);
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
            Wallet
            <select value={wallet} onChange={(event) => setWallet(event.target.value)}>
              <option value="">All</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="non_withdrawal">Non-Withdrawal</option>
            </select>
          </label>
        </div>
        <button type="button" className="secondary-button" onClick={() => loadTransfers(1)} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>From</th>
              <th>To</th>
              <th>Wallet</th>
              <th>Amount</th>
              <th>Commission</th>
              <th>Total</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="coupons-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="coupons-empty">
                  No transfers found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.transfer_id} className="history-row" onClick={() => setSelected(row)}>
                  <td>{row.transfer_id}</td>
                  <td>
                    {row.sender_id ?? '-'} / {row.sender_phone ?? '-'}
                  </td>
                  <td>
                    {row.receiver_id ?? '-'} / {row.receiver_phone ?? '-'}
                  </td>
                  <td>{row.wallet ?? '-'}</td>
                  <td>{row.amount}</td>
                  <td>{row.commission}</td>
                  <td>{row.total_amount}</td>
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
          onClick={() => loadTransfers(Math.max(page - 1, 1))}
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
          onClick={() => loadTransfers(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      {selected ? (
        <div className="drawer-overlay" role="presentation" onClick={closeDrawer}>
          <div className="drawer-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <h3>Transfer Details</h3>
              <button type="button" className="icon-button" onClick={closeDrawer} aria-label="Close">
                ×
              </button>
            </div>
            <div className="drawer-body">
              <div className="drawer-row">
                <span>ID</span>
                <strong>{selected.transfer_id}</strong>
              </div>
              <div className="drawer-row">
                <span>Sender</span>
                <strong>
                  {selected.sender_id ?? '-'} / {selected.sender_phone ?? '-'}
                </strong>
              </div>
              <div className="drawer-row">
                <span>Receiver</span>
                <strong>
                  {selected.receiver_id ?? '-'} / {selected.receiver_phone ?? '-'}
                </strong>
              </div>
              <div className="drawer-row">
                <span>Wallet</span>
                <strong>{selected.wallet ?? '-'}</strong>
              </div>
              <div className="drawer-row">
                <span>Amount</span>
                <strong>{selected.amount}</strong>
              </div>
              <div className="drawer-row">
                <span>Commission</span>
                <strong>{selected.commission}</strong>
              </div>
              <div className="drawer-row">
                <span>Total</span>
                <strong>{selected.total_amount}</strong>
              </div>
              <div className="drawer-row">
                <span>Created At</span>
                <strong>{new Date(selected.created_at).toLocaleString()}</strong>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default TransferHistory;
