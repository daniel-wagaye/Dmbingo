import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import AnnounceCouponModal from '../../components/AnnounceCouponModal';
import {
  CouponRow,
  createCoupon,
  fetchCoupons,
  finishCoupon,
  sendCouponWinners,
} from '../../services/couponService';
import { listRows } from '../../utils/listRows';

const CODE_REGEX = /^[A-Za-z0-9_-]{1,20}$/;

const toLocalInputValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const Coupons = () => {
  const [rows, setRows] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'created_at' | 'expires_at'>('created_at');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [sendWinnersOpen, setSendWinnersOpen] = useState(false);
  const [selected, setSelected] = useState<CouponRow | null>(null);
  const [notifyWinners, setNotifyWinners] = useState(true);

  const now = new Date();
  const [couponCode, setCouponCode] = useState('');
  const [couponPrize, setCouponPrize] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [startsAt, setStartsAt] = useState(toLocalInputValue(now));
  const [expiresAt, setExpiresAt] = useState(toLocalInputValue(new Date(now.getTime() + 86400000)));
  const [creditWallet, setCreditWallet] = useState<'withdrawal' | 'non_withdrawal'>('non_withdrawal');
  const [actionPassword, setActionPassword] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const loadSeq = useRef(0);

  const loadCoupons = async (nextPage = page) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const data = await fetchCoupons({
        page: nextPage,
        search: search.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sortBy,
      });
      if (seq !== loadSeq.current) return;
      setRows(listRows<CouponRow>(data.data));
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      if (seq !== loadSeq.current) return;
      const message = error instanceof Error ? error.message : 'Failed to load coupons';
      toast.error(message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadCoupons(1);
  }, []);

  const resetForm = () => {
    setCouponCode('');
    setCouponPrize('');
    setMaxUses('');
    setStartsAt(toLocalInputValue(new Date()));
    setExpiresAt(toLocalInputValue(new Date(Date.now() + 86400000)));
    setCreditWallet('non_withdrawal');
    setActionPassword('');
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const openFinish = (row: CouponRow) => {
    setSelected(row);
    setActionPassword('');
    setNotifyWinners(true);
    setFinishOpen(true);
  };

  const openAnnounce = (row: CouponRow) => {
    setSelected(row);
    setAnnounceOpen(true);
  };

  const openSendWinners = (row: CouponRow) => {
    setSelected(row);
    setActionPassword('');
    setSendWinnersOpen(true);
  };

  const closeModals = () => {
    setCreateOpen(false);
    setFinishOpen(false);
    setAnnounceOpen(false);
    setSendWinnersOpen(false);
    setSelected(null);
  };

  const validateCreate = () => {
    if (!CODE_REGEX.test(couponCode.trim())) {
      toast.error('Coupon code must be alphanumeric, - or _, max 20 chars.');
      return false;
    }
    const prizeValue = Number(couponPrize);
    if (!Number.isFinite(prizeValue) || prizeValue <= 0 || !/^\d+(\.\d{1,2})?$/.test(couponPrize)) {
      toast.error('Coupon prize must be a number with up to 2 decimals.');
      return false;
    }
    const maxUsesValue = Number(maxUses);
    if (!Number.isInteger(maxUsesValue) || maxUsesValue < 1) {
      toast.error('Max uses must be an integer greater than 0.');
      return false;
    }
    const starts = new Date(startsAt);
    const expires = new Date(expiresAt);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(expires.getTime())) {
      toast.error('Please enter valid dates.');
      return false;
    }
    if (expires.getTime() <= starts.getTime()) {
      toast.error('Expires At must be after Starts At.');
      return false;
    }
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return false;
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateCreate()) return;
    setActionLoading(true);
    try {
      await createCoupon({
        coupon_code: couponCode.trim(),
        coupon_prize: Number(couponPrize),
        max_uses_total: Number(maxUses),
        starts_at: new Date(startsAt).toISOString(),
        expires_at: new Date(expiresAt).toISOString(),
        credit_wallet: creditWallet,
        admin_password: actionPassword,
      });
      toast.success('Coupon created and set to ACTIVE.');
      closeModals();
      await loadCoupons(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed';
      toast.error(message === 'invalid_action_password' ? 'Password incorrect.' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!selected) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    setActionLoading(true);
    try {
      await finishCoupon(selected.coupon_id, {
        admin_password: actionPassword,
        notify_winners: notifyWinners,
      });
      toast.success(
        notifyWinners
          ? 'Coupon marked as finished. Winners list will be sent.'
          : 'Coupon marked as finished without notifying the group.'
      );
      closeModals();
      await loadCoupons(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Finish failed';
      toast.error(message === 'invalid_action_password' ? 'Password incorrect.' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendWinners = async () => {
    if (!selected) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    setActionLoading(true);
    try {
      await sendCouponWinners(selected.coupon_id, { admin_password: actionPassword });
      toast.success('Winners list sent.');
      closeModals();
      await loadCoupons(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Send failed';
      toast.error(
        message === 'invalid_action_password'
          ? 'Password incorrect.'
          : message === 'already_sent'
            ? 'Winners were already sent for this coupon.'
            : message
      );
    } finally {
      setActionLoading(false);
    }
  };

  const canCreate = useMemo(() => {
    if (!couponCode.trim() || !couponPrize.trim() || !maxUses.trim()) return false;
    if (!actionPassword.trim()) return false;
    if (!CODE_REGEX.test(couponCode.trim())) return false;
    if (!/^\d+(\.\d{1,2})?$/.test(couponPrize)) return false;
    if (!/^\d+$/.test(maxUses)) return false;
    const starts = new Date(startsAt);
    const expires = new Date(expiresAt);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(expires.getTime())) return false;
    return expires.getTime() > starts.getTime();
  }, [couponCode, couponPrize, maxUses, startsAt, expiresAt, actionPassword]);

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Coupons</h1>
          <p className="coupons-subtitle">Create and manage coupon rewards</p>
        </div>
        <div className="coupons-actions">
          <a className="secondary-button" href="/admin/coupons/history">
            Coupon History
          </a>
          <button type="button" className="primary-button" onClick={openCreate}>
            Create New Coupon
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
            if (event.key === 'Enter') loadCoupons(1);
          }}
        />
        <div className="coupons-date">
          <label>
            Starts After
            <input
              type="datetime-local"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            Expires Before
            <input
              type="datetime-local"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
        </div>
        <div className="coupons-sort">
          <label>
            Sort By
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as 'created_at' | 'expires_at')}>
              <option value="created_at">Created At</option>
              <option value="expires_at">Expires At</option>
            </select>
          </label>
        </div>
        <button type="button" className="secondary-button" onClick={() => loadCoupons(1)} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Coupon ID</th>
              <th>Coupon Code</th>
              <th>Prize</th>
              <th>Credit To</th>
              <th>Max Uses</th>
              <th>Current Uses</th>
              <th>Starts At</th>
              <th>Expires At</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Created By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="coupons-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="coupons-empty">
                  No coupons found.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const remaining = Math.max(row.max_uses_total - row.current_uses, 0);
                const showFinish = row.status === 'active' || row.status === 'expired';
                const canSendWinners = row.status === 'finished' && row.sent === false;
                return (
                  <tr key={row.coupon_id}>
                    <td>{index + 1}</td>
                    <td>{row.coupon_id}</td>
                    <td>{row.coupon_code}</td>
                    <td>{row.coupon_prize}</td>
                    <td>{row.credit_wallet === 'withdrawal' ? 'Withdrawal' : 'Non-Withdrawal'}</td>
                    <td title={`Max ${row.max_uses_total} | Used ${row.current_uses} | Remaining ${remaining}`}>
                      {row.max_uses_total}
                    </td>
                    <td>{row.current_uses}</td>
                    <td>{new Date(row.starts_at).toLocaleString()}</td>
                    <td>{new Date(row.expires_at).toLocaleString()}</td>
                    <td>
                      <span className={`status-pill ${row.status}`}>{row.status}</span>
                    </td>
                    <td>
                      <span className={`status-pill ${row.sent ? 'sent' : 'unsent'}`}>
                        {row.sent ? 'yes' : 'no'}
                      </span>
                    </td>
                    <td>{row.created_by ?? '-'}</td>
                    <td>
                      <div className="action-stack">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => openAnnounce(row)}
                        >
                          Announce
                        </button>
                        {canSendWinners ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => openSendWinners(row)}
                          >
                            Send winners
                          </button>
                        ) : null}
                        {showFinish ? (
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => openFinish(row)}
                          >
                            Finish
                          </button>
                        ) : null}
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
          onClick={() => loadCoupons(Math.max(page - 1, 1))}
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
          onClick={() => loadCoupons(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      {createOpen ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Create New Coupon</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="couponCode">Coupon Code</label>
                <input
                  id="couponCode"
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value)}
                />
                <span className="field-helper">Example: WELCOME50</span>
              </div>
              <div className="modal-field">
                <label htmlFor="couponPrize">Coupon Prize</label>
                <input
                  id="couponPrize"
                  type="number"
                  value={couponPrize}
                  onChange={(event) => setCouponPrize(event.target.value)}
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="modal-field">
                <label htmlFor="maxUses">Max Uses Total</label>
                <input
                  id="maxUses"
                  type="number"
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.target.value)}
                  min="1"
                  step="1"
                />
              </div>
              <div className="modal-field">
                <label htmlFor="startsAt">Starts At</label>
                <input
                  id="startsAt"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="expiresAt">Expires At</label>
                <input
                  id="expiresAt"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="creditWallet">Credit To</label>
                <select
                  id="creditWallet"
                  value={creditWallet}
                  onChange={(event) =>
                    setCreditWallet(event.target.value as 'withdrawal' | 'non_withdrawal')
                  }
                >
                  <option value="withdrawal">Withdrawal Wallet</option>
                  <option value="non_withdrawal">Non-Withdrawal Wallet</option>
                </select>
              </div>
              <div className="modal-field">
                <label htmlFor="couponPassword">Admin Action Password</label>
                <input
                  id="couponPassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
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
                onClick={handleCreate}
                disabled={!canCreate || actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {finishOpen && selected ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Finish Coupon</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirmation">
                Finish coupon <strong>{selected.coupon_code}</strong>? Players will no longer be able
                to redeem it.
              </p>
              <div className="modal-field checkbox-field">
                <label htmlFor="notifyWinners">
                  <input
                    id="notifyWinners"
                    type="checkbox"
                    checked={notifyWinners}
                    onChange={(event) => setNotifyWinners(event.target.checked)}
                  />
                  Notify the user (send winners CSV to the group)
                </label>
                <span className="field-helper">
                  Turn this off to close the coupon without sending Telegram. That also marks Sent as
                  yes so the webhook will not send later.
                </span>
              </div>
              <div className="modal-field">
                <label htmlFor="finishPassword">Admin Action Password</label>
                <input
                  id="finishPassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeModals}>
                Close
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={handleFinish}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Sure!'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sendWinnersOpen && selected ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Send Winners</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirmation">
                Send the winners CSV for <strong>{selected.coupon_code}</strong> to the coupon group?
                Telegram will receive the file plus the caption:
              </p>
              <pre className="coupon-caption-preview">{'የኩፖኑ ተሸላሚዎች 🎁☝️\nተጠናቋል ✅'}</pre>
              <div className="modal-field">
                <label htmlFor="sendWinnersPassword">Admin Action Password</label>
                <input
                  id="sendWinnersPassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
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
                onClick={() => void handleSendWinners()}
                disabled={actionLoading}
              >
                {actionLoading ? 'Sending...' : 'Send winners'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {announceOpen && selected ? (
        <AnnounceCouponModal
          coupon={selected}
          onClose={closeModals}
          onSent={() => {
            closeModals();
            void loadCoupons(page);
          }}
        />
      ) : null}
    </div>
  );
};

export default Coupons;
