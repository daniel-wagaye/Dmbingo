import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import TelegramIdCell from '../../components/TelegramIdCell';
import UserDetailsModal from '../../components/UserDetailsModal';
import { fetchReferralHistory, ReferralHistoryRow } from '../../services/historyService';

const ReferralHistory = () => {
  const [rows, setRows] = useState<ReferralHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [rewarded, setRewarded] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);

  const loadReferrals = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchReferralHistory({
        page: nextPage,
        search: search.trim() || undefined,
        rewarded: rewarded || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load referrals';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReferrals(1);
  }, []);

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Referral History</h1>
          <p className="coupons-subtitle">Track rewarded referrals</p>
        </div>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search referrer or referred ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') loadReferrals(1);
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
            Rewarded
            <select value={rewarded} onChange={(event) => setRewarded(event.target.value)}>
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        </div>
        <button type="button" className="secondary-button" onClick={() => loadReferrals(1)} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Referrer ID</th>
              <th>Referred ID</th>
              <th>Rewarded</th>
              <th>Reward Amount</th>
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
                  No referrals found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.referral_id}>
                  <td>{row.referral_id}</td>
                  <td><TelegramIdCell telegramId={row.referrer_id} onClick={setDetailId} /></td>
                  <td><TelegramIdCell telegramId={row.referred_user_id} onClick={setDetailId} /></td>
                  <td>
                    <span className={`status-pill ${row.rewarded ? 'active' : 'inactive'}`}>
                      {row.rewarded ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>{row.rewarded_amount ?? '-'}</td>
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
          onClick={() => loadReferrals(Math.max(page - 1, 1))}
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
          onClick={() => loadReferrals(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>
      <UserDetailsModal telegramId={detailId} open={detailId !== null} onClose={() => setDetailId(null)} />
    </div>
  );
};

export default ReferralHistory;
