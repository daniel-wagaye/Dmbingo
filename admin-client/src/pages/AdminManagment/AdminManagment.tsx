import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  AdminRow,
  createAdmin,
  fetchAdmins,
  updateAdmin,
  updateAdminStatus,
} from '../../services/adminService';

const USERNAME_REGEX = /^[A-Za-z0-9_-]{3,32}$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

const AdminManagment = () => {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [createOpen, setCreateOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createFirstName, setCreateFirstName] = useState('');
  const [createLastName, setCreateLastName] = useState('');
  const [createLoginPassword, setCreateLoginPassword] = useState('');
  const [createActionPassword, setCreateActionPassword] = useState('');
  const [createSuperActionPassword, setCreateSuperActionPassword] = useState('');
  const [showCreateLoginPassword, setShowCreateLoginPassword] = useState(false);
  const [showCreateActionPassword, setShowCreateActionPassword] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editAdmin, setEditAdmin] = useState<AdminRow | null>(null);
  const [editMode, setEditMode] = useState<'username' | 'login_password' | 'action_password' | 'all'>(
    'username'
  );
  const [editUsername, setEditUsername] = useState('');
  const [editLoginPassword, setEditLoginPassword] = useState('');
  const [editActionPassword, setEditActionPassword] = useState('');
  const [editSuperActionPassword, setEditSuperActionPassword] = useState('');
  const [showEditLoginPassword, setShowEditLoginPassword] = useState(false);
  const [showEditActionPassword, setShowEditActionPassword] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  const [statusOpen, setStatusOpen] = useState(false);
  const [statusAdmin, setStatusAdmin] = useState<AdminRow | null>(null);
  const [statusValue, setStatusValue] = useState(false);
  const [statusActionPassword, setStatusActionPassword] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  const loadAdmins = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchAdmins({
        page: nextPage,
        search: search.trim() || undefined,
        sortOrder,
      });
      setRows(Array.isArray(data.data) ? data.data : []);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load admins';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdmins(1);
  }, [sortOrder]);

  const applyFilters = () => {
    loadAdmins(1);
  };

  const openCreate = () => {
    setCreateUsername('');
    setCreateFirstName('');
    setCreateLastName('');
    setCreateLoginPassword('');
    setCreateActionPassword('');
    setCreateSuperActionPassword('');
    setShowCreateLoginPassword(false);
    setShowCreateActionPassword(false);
    setCreateError('');
    setCreateOpen(true);
  };

  const closeCreate = () => setCreateOpen(false);

  const openEdit = (admin: AdminRow) => {
    setEditAdmin(admin);
    setEditMode('username');
    setEditUsername(admin.username);
    setEditLoginPassword('');
    setEditActionPassword('');
    setEditSuperActionPassword('');
    setShowEditLoginPassword(false);
    setShowEditActionPassword(false);
    setEditError('');
    setEditOpen(true);
  };

  const closeEdit = () => setEditOpen(false);

  const openStatus = (admin: AdminRow, nextValue: boolean) => {
    setStatusAdmin(admin);
    setStatusValue(nextValue);
    setStatusActionPassword('');
    setStatusError('');
    setStatusOpen(true);
  };

  const closeStatus = () => setStatusOpen(false);

  const createDisabled = useMemo(() => createLoading, [createLoading]);

  const getCreateValidationError = () => {
    if (!createUsername.trim()) return 'Enter username.';
    if (!USERNAME_REGEX.test(createUsername.trim())) {
      return 'Username must be 3-32 chars using letters, numbers, _ or -.';
    }
    if (!createFirstName.trim()) return 'Enter first name.';
    if (!createLoginPassword.trim()) return 'Enter login password.';
    if (!PASSWORD_REGEX.test(createLoginPassword)) {
      return 'Login password must be 8+ chars with upper, lower, number, and symbol.';
    }
    if (!createActionPassword.trim()) return 'Enter action password.';
    if (!PASSWORD_REGEX.test(createActionPassword)) {
      return 'Action password must be 8+ chars with upper, lower, number, and symbol.';
    }
    if (!createSuperActionPassword.trim()) return 'Enter super admin action password.';
    return '';
  };

  const editDisabled = useMemo(() => {
    if (!editSuperActionPassword.trim()) return true;
    if (editMode === 'username' && !USERNAME_REGEX.test(editUsername.trim())) return true;
    if (editMode === 'login_password' && !PASSWORD_REGEX.test(editLoginPassword)) return true;
    if (editMode === 'action_password' && !PASSWORD_REGEX.test(editActionPassword)) return true;
    if (
      editMode === 'all' &&
      (!USERNAME_REGEX.test(editUsername.trim()) ||
        !PASSWORD_REGEX.test(editLoginPassword) ||
        !PASSWORD_REGEX.test(editActionPassword))
    ) {
      return true;
    }
    return false;
  }, [editMode, editUsername, editLoginPassword, editActionPassword, editSuperActionPassword]);

  const handleCreate = async () => {
    const validationError = getCreateValidationError();
    if (validationError) {
      setCreateError(validationError);
      toast.error(validationError);
      return;
    }
    setCreateLoading(true);
    setCreateError('');
    try {
      const result = await createAdmin({
        role: 'withdrawal_admin',
        username: createUsername.trim(),
        firstName: createFirstName.trim(),
        lastName: createLastName.trim() || undefined,
        loginPassword: createLoginPassword,
        actionPassword: createActionPassword,
        superAdminActionPassword: createSuperActionPassword,
      });
      toast.success('Admin created.');
      setRows((prev) => [result.admin, ...prev]);
      closeCreate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed';
      const friendlyMessage =
        message === 'invalid_action_password'
          ? 'Incorrect super admin action password.'
          : message === 'invalid_username'
          ? 'Username must be 3-32 chars using letters, numbers, _ or -.'
          : message === 'invalid_password'
          ? 'Password must be 8+ chars with upper, lower, number, and symbol.'
          : message === 'username_exists'
          ? 'Username already exists.'
          : message;
      setCreateError(friendlyMessage);
      toast.error(friendlyMessage);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editAdmin || editDisabled) return;
    setEditLoading(true);
    setEditError('');
    try {
      const payload = {
        editMode,
        username: editMode === 'username' || editMode === 'all' ? editUsername.trim() : undefined,
        loginPassword: editMode === 'login_password' || editMode === 'all' ? editLoginPassword : undefined,
        actionPassword: editMode === 'action_password' || editMode === 'all' ? editActionPassword : undefined,
        superAdminActionPassword: editSuperActionPassword,
      };
      const result = await updateAdmin(editAdmin.admin_id, payload);
      toast.success('Admin updated.');
      setRows((prev) =>
        prev.map((row) => (row.admin_id === result.admin.admin_id ? result.admin : row))
      );
      closeEdit();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      setEditError(message);
      toast.error(message);
    } finally {
      setEditLoading(false);
    }
  };

  const handleStatusUpdate = async () => {
    if (!statusAdmin) return;
    if (!statusActionPassword.trim()) {
      setStatusError('Enter action password.');
      return;
    }
    setStatusLoading(true);
    setStatusError('');
    try {
      const result = await updateAdminStatus(statusAdmin.admin_id, {
        isActive: statusValue,
        actionPassword: statusActionPassword,
      });
      toast.success('Status updated.');
      setRows((prev) =>
        prev.map((row) => (row.admin_id === result.admin.admin_id ? result.admin : row))
      );
      closeStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      setStatusError(message);
      toast.error(message);
    } finally {
      setStatusLoading(false);
    }
  };

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Admin Management</h1>
          <p className="coupons-subtitle">Manage admin accounts</p>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>
          Create Admin
        </button>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search username or name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') applyFilters();
          }}
        />
        <button type="button" className="secondary-button" onClick={applyFilters} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>Admin ID</th>
              <th>Role</th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Username</th>
              <th>
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                >
                  Created At {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </th>
              <th>Is Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="coupons-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="coupons-empty">
                  No admins found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.admin_id}>
                  <td>{row.admin_id}</td>
                  <td>{row.role}</td>
                  <td>{row.first_name ?? '-'}</td>
                  <td>{row.last_name ?? '-'}</td>
                  <td>{row.username}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={() => openStatus(row, !row.is_active)}
                      aria-label={`Set active for ${row.username}`}
                    />
                  </td>
                  <td>
                    <button type="button" className="secondary-button" onClick={() => openEdit(row)}>
                      Edit
                    </button>
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
          onClick={() => loadAdmins(Math.max(page - 1, 1))}
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
          onClick={() => loadAdmins(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      {createOpen ? (
        <div className="modal-overlay" role="presentation" onClick={closeCreate}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Admin</h3>
              <button type="button" className="icon-button" onClick={closeCreate} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="modal-field">
                Role
                <select value="withdrawal_admin" disabled>
                  <option value="withdrawal_admin">withdrawal_admin</option>
                </select>
              </label>
              <label className="modal-field">
                Username
                <input
                  type="text"
                  value={createUsername}
                  onChange={(event) => setCreateUsername(event.target.value)}
                  aria-label="Username"
                />
              </label>
              <label className="modal-field">
                First name
                <input
                  type="text"
                  value={createFirstName}
                  onChange={(event) => setCreateFirstName(event.target.value)}
                  aria-label="First name"
                />
              </label>
              <label className="modal-field">
                Last name
                <input
                  type="text"
                  value={createLastName}
                  onChange={(event) => setCreateLastName(event.target.value)}
                  aria-label="Last name"
                />
              </label>
              <label className="modal-field">
                Login password
                <div className="password-input-row">
                  <input
                    type={showCreateLoginPassword ? 'text' : 'password'}
                    value={createLoginPassword}
                    onChange={(event) => setCreateLoginPassword(event.target.value)}
                    aria-label="Login password"
                  />
                  <button
                    type="button"
                    className="password-toggle-button"
                    onMouseDown={() => setShowCreateLoginPassword(true)}
                    onMouseUp={() => setShowCreateLoginPassword(false)}
                    onMouseLeave={() => setShowCreateLoginPassword(false)}
                    onTouchStart={() => setShowCreateLoginPassword(true)}
                    onTouchEnd={() => setShowCreateLoginPassword(false)}
                    aria-label="Hold to view login password"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                      className="password-toggle-icon"
                    >
                      <path
                        fill="currentColor"
                        d="M12 5c-5.05 0-9.27 3.11-11 7 1.73 3.89 5.95 7 11 7s9.27-3.11 11-7c-1.73-3.89-5.95-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                      />
                    </svg>
                  </button>
                </div>
              </label>
              <label className="modal-field">
                Action password
                <div className="password-input-row">
                  <input
                    type={showCreateActionPassword ? 'text' : 'password'}
                    value={createActionPassword}
                    onChange={(event) => setCreateActionPassword(event.target.value)}
                    aria-label="Action password"
                  />
                  <button
                    type="button"
                    className="password-toggle-button"
                    onMouseDown={() => setShowCreateActionPassword(true)}
                    onMouseUp={() => setShowCreateActionPassword(false)}
                    onMouseLeave={() => setShowCreateActionPassword(false)}
                    onTouchStart={() => setShowCreateActionPassword(true)}
                    onTouchEnd={() => setShowCreateActionPassword(false)}
                    aria-label="Hold to view action password"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                      className="password-toggle-icon"
                    >
                      <path
                        fill="currentColor"
                        d="M12 5c-5.05 0-9.27 3.11-11 7 1.73 3.89 5.95 7 11 7s9.27-3.11 11-7c-1.73-3.89-5.95-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                      />
                    </svg>
                  </button>
                </div>
              </label>
              <label className="modal-field">
                Super Admin Action Password
                <input
                  type="password"
                  value={createSuperActionPassword}
                  onChange={(event) => setCreateSuperActionPassword(event.target.value)}
                  aria-label="Super Admin Action Password"
                />
              </label>
              {createError ? <div className="modal-error">{createError}</div> : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeCreate}>
                Close
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleCreate}
                disabled={createDisabled || createLoading}
              >
                {createLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen && editAdmin ? (
        <div className="modal-overlay" role="presentation" onClick={closeEdit}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Admin</h3>
              <button type="button" className="icon-button" onClick={closeEdit} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="modal-field">
                Edit Mode
                <select
                  value={editMode}
                  onChange={(event) =>
                    setEditMode(event.target.value as 'username' | 'login_password' | 'action_password' | 'all')
                  }
                >
                  <option value="username">Username</option>
                  <option value="login_password">Login password</option>
                  <option value="action_password">Action password</option>
                  <option value="all">All</option>
                </select>
              </label>
              {editMode === 'username' || editMode === 'all' ? (
                <label className="modal-field">
                  Username
                  <input
                    type="text"
                    value={editUsername}
                    onChange={(event) => setEditUsername(event.target.value)}
                  />
                </label>
              ) : null}
              {editMode === 'login_password' || editMode === 'all' ? (
                <label className="modal-field">
                  Login password
                  <div className="password-input-row">
                    <input
                      type={showEditLoginPassword ? 'text' : 'password'}
                      value={editLoginPassword}
                      onChange={(event) => setEditLoginPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle-button"
                      onMouseDown={() => setShowEditLoginPassword(true)}
                      onMouseUp={() => setShowEditLoginPassword(false)}
                      onMouseLeave={() => setShowEditLoginPassword(false)}
                      onTouchStart={() => setShowEditLoginPassword(true)}
                      onTouchEnd={() => setShowEditLoginPassword(false)}
                      aria-label="Hold to view login password"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                        className="password-toggle-icon"
                      >
                        <path
                          fill="currentColor"
                          d="M12 5c-5.05 0-9.27 3.11-11 7 1.73 3.89 5.95 7 11 7s9.27-3.11 11-7c-1.73-3.89-5.95-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                        />
                      </svg>
                    </button>
                  </div>
                </label>
              ) : null}
              {editMode === 'action_password' || editMode === 'all' ? (
                <label className="modal-field">
                  Action password
                  <div className="password-input-row">
                    <input
                      type={showEditActionPassword ? 'text' : 'password'}
                      value={editActionPassword}
                      onChange={(event) => setEditActionPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle-button"
                      onMouseDown={() => setShowEditActionPassword(true)}
                      onMouseUp={() => setShowEditActionPassword(false)}
                      onMouseLeave={() => setShowEditActionPassword(false)}
                      onTouchStart={() => setShowEditActionPassword(true)}
                      onTouchEnd={() => setShowEditActionPassword(false)}
                      aria-label="Hold to view action password"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                        className="password-toggle-icon"
                      >
                        <path
                          fill="currentColor"
                          d="M12 5c-5.05 0-9.27 3.11-11 7 1.73 3.89 5.95 7 11 7s9.27-3.11 11-7c-1.73-3.89-5.95-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                        />
                      </svg>
                    </button>
                  </div>
                </label>
              ) : null}
              <label className="modal-field">
                Super Admin Action Password
                <input
                  type="password"
                  value={editSuperActionPassword}
                  onChange={(event) => setEditSuperActionPassword(event.target.value)}
                />
              </label>
              {editError ? <div className="modal-error">{editError}</div> : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeEdit}>
                Close
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleEdit}
                disabled={editDisabled || editLoading}
              >
                {editLoading ? 'Saving...' : 'Change'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {statusOpen && statusAdmin ? (
        <div className="modal-overlay" role="presentation" onClick={closeStatus}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{statusValue ? 'Activate Admin' : 'Deactivate Admin'}</h3>
              <button type="button" className="icon-button" onClick={closeStatus} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <span>Admin</span>
                <strong>{statusAdmin.username}</strong>
              </div>
              <label className="modal-field">
                Super Admin Action Password
                <input
                  type="password"
                  value={statusActionPassword}
                  onChange={(event) => setStatusActionPassword(event.target.value)}
                />
              </label>
              {statusError ? <div className="modal-error">{statusError}</div> : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeStatus}>
                Close
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleStatusUpdate}
                disabled={statusLoading}
              >
                {statusLoading ? 'Updating...' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AdminManagment;
