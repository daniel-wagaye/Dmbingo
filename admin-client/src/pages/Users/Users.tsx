import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import TelegramIdCell from '../../components/TelegramIdCell';
import UserDetailsModal from '../../components/UserDetailsModal';
import SendUserMessageModal from '../../components/SendUserMessageModal';
import { creditUser, fetchUsers } from '../../services/userService';

type UserRow = {
  telegram_id: number;
  first_name: string | null;
  phone_number: string | null;
  username: string | null;
  withdrawal_wallet: string;
  non_withdrawal_wallet: string;
  referral_count: number;
  streak_count: number;
  last_play_date: string | null;
  created_at: string;
};

const formatNumber = (value: string | number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0));

const formatPlayDate = (value: string | null) => {
  if (!value) return '-';
  return String(value).slice(0, 10);
};

const Users = () => {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [creditOpen, setCreditOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [actionPassword, setActionPassword] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditWallet, setCreditWallet] = useState<'withdrawal' | 'non_withdrawal' | ''>('');
  const [creditLoading, setCreditLoading] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const columns = useMemo(
    () => [
      { key: 'telegram_id', label: 'Telegram ID' },
      { key: 'first_name', label: 'First Name' },
      { key: 'phone_number', label: 'Phone Number' },
      { key: 'username', label: 'Username' },
      { key: 'withdrawal_wallet', label: 'Withdrawable' },
      { key: 'non_withdrawal_wallet', label: 'Non-Withdrawable' },
      { key: 'referral_count', label: 'Referral Count' },
      { key: 'streak_count', label: 'Streak' },
      { key: 'last_play_date', label: 'Last Played' },
      { key: 'created_at', label: 'Created At' },
    ],
    []
  );

  const loadUsers = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchUsers({
        search: search.trim() || undefined,
        page: nextPage,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sortBy,
        sortOrder,
      });
      setRows(Array.isArray(data.data) ? data.data : []);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load users';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers(1);
  }, [sortBy, sortOrder]);

  const applyFilters = () => {
    if (startDate && endDate && new Date(endDate).getTime() < new Date(startDate).getTime()) {
      toast.error('End date must be after start date.');
      return;
    }
    loadUsers(1);
  };

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortBy(key);
    setSortOrder('desc');
  };

  const openCredit = (user: UserRow) => {
    setSelectedUser(user);
    setActionPassword('');
    setCreditAmount('');
    setCreditWallet('');
    setCreditOpen(true);
  };

  const closeCredit = () => {
    setCreditOpen(false);
  };

  const openMessage = (user: UserRow) => {
    setSelectedUser(user);
    setMessageOpen(true);
  };

  const closeMessage = () => {
    setMessageOpen(false);
  };

  const submitCredit = async () => {
    if (!selectedUser) return;
    const amountValue = Number(creditAmount);
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    if (!creditWallet) {
      toast.error('Select wallet.');
      return;
    }
    if (!amountValue || amountValue <= 0) {
      toast.error('Enter a valid amount.');
      return;
    }
    setCreditLoading(true);
    try {
      const result = await creditUser({
        telegramId: selectedUser.telegram_id,
        amount: amountValue,
        wallet: creditWallet,
        actionPassword,
      });
      setRows((prev) =>
        prev.map((row) =>
          row.telegram_id === result.user.telegram_id ? { ...row, ...result.user } : row
        )
      );
      toast.success('Credit applied.');
      closeCredit();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Credit failed';
      toast.error(
        message === 'invalid_action_password' ? 'Incorrect action password.' : message
      );
    } finally {
      setCreditLoading(false);
    }
  };

  return (
    <div className="users-page">
      <div className="users-header">
        <div>
          <h1>Users</h1>
          <p className="users-subtitle">Manage player accounts</p>
        </div>
      </div>

      <div className="users-controls">
        <input
          className="users-input"
          placeholder="Search by username, phone, or telegram id"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <input
          className="users-input"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <input
          className="users-input"
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
        <button className="primary-button" type="button" onClick={applyFilters}>
          Apply
        </button>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>#</th>
              {columns.map((column) => (
                <th key={column.key}>
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => toggleSort(column.key)}
                  >
                    {column.label}
                    {sortBy === column.key ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="users-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="users-empty">
                  No users found.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row.telegram_id}>
                  <td>{index + 1}</td>
                  <td><TelegramIdCell telegramId={row.telegram_id} onClick={setDetailId} /></td>
                  <td>{row.first_name ?? '-'}</td>
                  <td>{row.phone_number ?? '-'}</td>
                  <td>{row.username ?? '-'}</td>
                  <td>{formatNumber(row.withdrawal_wallet)}</td>
                  <td>{formatNumber(row.non_withdrawal_wallet)}</td>
                  <td>{row.referral_count}</td>
                  <td>{row.streak_count ?? 0}</td>
                  <td>{formatPlayDate(row.last_play_date)}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    <div className="action-stack">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openCredit(row)}
                      >
                        Credit
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openMessage(row)}
                      >
                        Message
                      </button>
                    </div>
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
          onClick={() => loadUsers(Math.max(page - 1, 1))}
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
          onClick={() => loadUsers(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      <UserDetailsModal telegramId={detailId} open={detailId !== null} onClose={() => setDetailId(null)} />

      {creditOpen && selectedUser ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Credit User</h3>
              <button type="button" className="icon-button" onClick={closeCredit} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="actionPassword">Action Password</label>
                <input
                  id="actionPassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="creditAmount">Amount</label>
                <input
                  id="creditAmount"
                  type="number"
                  min="0"
                  value={creditAmount}
                  onChange={(event) => setCreditAmount(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="creditWallet">Wallet</label>
                <select
                  id="creditWallet"
                  value={creditWallet}
                  onChange={(event) =>
                    setCreditWallet(event.target.value as 'withdrawal' | 'non_withdrawal' | '')
                  }
                >
                  <option value="">Select wallet</option>
                  <option value="withdrawal">Withdrawal Wallet</option>
                  <option value="non_withdrawal">Non-Withdrawal Wallet</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeCredit}>
                Close
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={submitCredit}
                disabled={creditLoading}
              >
                {creditLoading ? 'Processing...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {messageOpen && selectedUser ? (
        <SendUserMessageModal user={selectedUser} onClose={closeMessage} />
      ) : null}
    </div>
  );
};

export default Users;
