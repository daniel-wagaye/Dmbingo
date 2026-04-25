import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import TelegramIdCell from '../../components/TelegramIdCell';
import UserDetailsModal from '../../components/UserDetailsModal';
import {
  CouponHistoryRow,
  exportCouponHistory,
  fetchCouponHistory,
} from '../../services/couponService';

const CouponHistory = () => {
  const [rows, setRows] = useState<CouponHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [telegramId, setTelegramId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);

  const loadHistory = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchCouponHistory({
        page: nextPage,
        search: search.trim() || undefined,
        telegramId: telegramId.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load history';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory(1);
  }, []);

  const handleExport = async () => {
    try {
      const blob = await exportCouponHistory({
        search: search.trim() || undefined,
        telegramId: telegramId.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'coupon_history.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      toast.error(message);
    }
  };

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Coupon History</h1>
          <p className="coupons-subtitle">Read-only claims and usage records</p>
        </div>
        <div className="coupons-actions">
          <a className="secondary-button" href="/admin/coupons">
            Back to Coupons
          </a>
          <button type="button" className="secondary-button" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search coupon code"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') loadHistory(1);
          }}
        />
        <input
          type="text"
          className="coupons-input"
          placeholder="User Telegram ID"
          value={telegramId}
          onChange={(event) => setTelegramId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') loadHistory(1);
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
        <button type="button" className="secondary-button" onClick={() => loadHistory(1)} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>Claimed ID</th>
              <th>Coupon Code</th>
              <th>Coupon ID</th>
              <th>User Telegram ID</th>
              <th>Claimed At</th>
              <th>Coupon Prize</th>
              <th>Credited Amount</th>
              <th>Credit To</th>
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
                  No history found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.claimed_id}>
                  <td>{row.claimed_id}</td>
                  <td>{row.coupon_code ?? '-'}</td>
                  <td>{row.coupon_id ?? '-'}</td>
                  <td>
                    <TelegramIdCell telegramId={row.user_telegram_id} onClick={setDetailId} />
                  </td>
                  <td>{new Date(row.claimed_at).toLocaleString()}</td>
                  <td>{row.coupon_prize ?? '-'}</td>
                  <td>{row.credited_amount ?? '-'}</td>
                  <td>
                    {row.credit_wallet
                      ? row.credit_wallet === 'withdrawal'
                        ? 'Withdrawal'
                        : 'Non-Withdrawal'
                      : '-'}
                  </td>
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
          onClick={() => loadHistory(Math.max(page - 1, 1))}
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
          onClick={() => loadHistory(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>
      <UserDetailsModal telegramId={detailId} open={detailId !== null} onClose={() => setDetailId(null)} />
    </div>
  );
};

export default CouponHistory;
