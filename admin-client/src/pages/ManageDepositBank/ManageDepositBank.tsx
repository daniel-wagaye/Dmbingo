import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  BankRow,
  createBank,
  deleteBank,
  fetchBanks,
  updateBank,
} from '../../services/manageDepositBankService';

const ACCOUNT_NUMBER_REGEX = /^\d{5,20}$/;

const ManageDepositBank = () => {
  const [rows, setRows] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<BankRow | null>(null);
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [actionPassword, setActionPassword] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadBanks = async (nextPage = page, query = search) => {
    setLoading(true);
    try {
      const data = await fetchBanks({ page: nextPage, search: query.trim() || undefined });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load banks';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBanks(1);
  }, []);

  const resetForm = () => {
    setBankName('');
    setAccountNumber('');
    setAccountHolderName('');
    setActionPassword('');
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const openEdit = (bank: BankRow) => {
    setSelectedBank(bank);
    setBankName(bank.bank_name);
    setAccountNumber(bank.account_number);
    setAccountHolderName(bank.account_holder_name);
    setActionPassword('');
    setEditOpen(true);
  };

  const openDelete = (bank: BankRow) => {
    setSelectedBank(bank);
    setActionPassword('');
    setDeleteOpen(true);
  };

  const closeModals = () => {
    setCreateOpen(false);
    setEditOpen(false);
    setDeleteOpen(false);
    setSelectedBank(null);
  };

  const validateForm = () => {
    if (!bankName.trim() || !accountNumber.trim() || !accountHolderName.trim()) {
      toast.error('All fields are required.');
      return false;
    }
    if (bankName.trim().length > 64 || accountHolderName.trim().length > 64) {
      toast.error('Names must be at most 64 characters.');
      return false;
    }
    if (!ACCOUNT_NUMBER_REGEX.test(accountNumber.trim())) {
      toast.error('Account number must be 9–13 digits.');
      return false;
    }
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return false;
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateForm()) return;
    setActionLoading(true);
    try {
      await createBank({
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        accountHolderName: accountHolderName.trim(),
        actionPassword,
      });
      toast.success('Bank account created.');
      closeModals();
      loadBanks(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed';
      toast.error(message === 'invalid_action_password' ? 'Incorrect action password.' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedBank) return;
    if (!validateForm()) return;
    setActionLoading(true);
    try {
      await updateBank(selectedBank.id, {
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        accountHolderName: accountHolderName.trim(),
        actionPassword,
      });
      toast.success('Bank account updated.');
      closeModals();
      loadBanks(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      toast.error(message === 'invalid_action_password' ? 'Incorrect action password.' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedBank) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    setActionLoading(true);
    try {
      await deleteBank(selectedBank.id, { actionPassword });
      toast.success('Bank account deleted.');
      closeModals();
      loadBanks(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      toast.error(message === 'invalid_action_password' ? 'Incorrect action password.' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const onSearch = () => loadBanks(1);

  return (
    <div className="banks-page">
      <div className="banks-header">
        <div>
          <h1>Bank Accounts</h1>
          <p className="banks-subtitle">Manage deposit bank accounts</p>
        </div>
        <div className="banks-actions">
          <button type="button" className="primary-button" onClick={openCreate}>
            Create Bank
          </button>
        </div>
      </div>

      <div className="banks-controls">
        <input
          type="text"
          className="banks-input"
          placeholder="Search by bank name or account number"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSearch();
          }}
        />
        <button type="button" className="secondary-button" onClick={onSearch} disabled={loading}>
          Search
        </button>
      </div>

      <div className="banks-table-wrapper">
        <table className="banks-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Bank Name</th>
              <th>Account Number</th>
              <th>Account Holder</th>
              <th>Created At</th>
              <th>Updated At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="banks-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="banks-empty">
                  No bank accounts found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.bank_name}</td>
                  <td>{row.account_number}</td>
                  <td>{row.account_holder_name}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{new Date(row.updated_at).toLocaleString()}</td>
                  <td>
                    <div className="action-stack">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => openDelete(row)}
                      >
                        Delete
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
          onClick={() => loadBanks(Math.max(page - 1, 1))}
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
          onClick={() => loadBanks(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      {createOpen ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Create Bank Account</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="createBankName">Bank Name</label>
                <input
                  id="createBankName"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="createAccountNumber">Account Number</label>
                <input
                  id="createAccountNumber"
                  value={accountNumber}
                  onChange={(event) => setAccountNumber(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="createHolderName">Account Holder Name</label>
                <input
                  id="createHolderName"
                  value={accountHolderName}
                  onChange={(event) => setAccountHolderName(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="createPassword">Action Password</label>
                <input
                  id="createPassword"
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
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen && selectedBank ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Edit Bank — #{selectedBank.id}</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="editBankName">Bank Name</label>
                <input
                  id="editBankName"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="editAccountNumber">Account Number</label>
                <input
                  id="editAccountNumber"
                  value={accountNumber}
                  onChange={(event) => setAccountNumber(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="editHolderName">Account Holder Name</label>
                <input
                  id="editHolderName"
                  value={accountHolderName}
                  onChange={(event) => setAccountHolderName(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="editPassword">Action Password</label>
                <input
                  id="editPassword"
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
                onClick={handleEdit}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteOpen && selectedBank ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Delete Bank</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirmation">
                Are you sure you want to permanently delete {selectedBank.bank_name} —{' '}
                {selectedBank.account_number}? This will remove it from the Deposit page.
              </p>
              <div className="modal-field">
                <label htmlFor="deletePassword">Action Password</label>
                <input
                  id="deletePassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeModals}>
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={handleDelete}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ManageDepositBank;
