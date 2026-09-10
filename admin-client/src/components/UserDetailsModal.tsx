import { useEffect, useState } from 'react';
import { fetchUserByTelegramId, type UserDetail } from '../services/userService';

type UserDetailsModalProps = {
  telegramId: number | null;
  open: boolean;
  onClose: () => void;
};

const formatNumber = (value: string | number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0));

const formatPlayDate = (value: string | null) => {
  if (!value) return '-';
  return String(value).slice(0, 10);
};

const UserDetailsModal = ({ telegramId, open, onClose }: UserDetailsModalProps) => {
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || telegramId == null) {
      setUser(null);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchUserByTelegramId(telegramId)
      .then((data) => {
        if (!cancelled) setUser(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load user');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, telegramId]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-card user-details-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>User Details</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {loading && <p className="users-empty">Loading...</p>}
          {error && <p className="users-empty">{error}</p>}
          {!loading && !error && user && (
            <div className="user-details-grid">
              <div className="user-detail-row">
                <span className="user-detail-label">Telegram ID</span>
                <span className="user-detail-value mono">{user.telegram_id}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">First Name</span>
                <span className="user-detail-value">{user.first_name ?? '-'}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Username</span>
                <span className="user-detail-value">{user.username ?? '-'}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Phone</span>
                <span className="user-detail-value">{user.phone_number ?? '-'}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Withdrawable</span>
                <span className="user-detail-value">{formatNumber(user.withdrawal_wallet)}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Non-Withdrawable</span>
                <span className="user-detail-value">{formatNumber(user.non_withdrawal_wallet)}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Referrals</span>
                <span className="user-detail-value">{user.referral_count}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Streak</span>
                <span className="user-detail-value">{user.streak_count ?? 0}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Last Played</span>
                <span className="user-detail-value">{formatPlayDate(user.last_play_date)}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Last Referred</span>
                <span className="user-detail-value">
                  {user.last_referred_date ? new Date(user.last_referred_date).toLocaleString() : '-'}
                </span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Language</span>
                <span className="user-detail-value">{user.language === 'am' ? 'Amharic' : 'English'}</span>
              </div>
              <div className="user-detail-row">
                <span className="user-detail-label">Joined</span>
                <span className="user-detail-value">{new Date(user.created_at).toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserDetailsModal;
