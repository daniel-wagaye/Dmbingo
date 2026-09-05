import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  RegexConfigRow,
  createRegexConfig,
  deleteRegexConfig,
  fetchRegexConfigs,
  updateRegexConfig,
  wakeupRegexAcceptor,
} from '../../services/regexConfigService';

const JSON_MAX_LENGTH = 300;
const REQUIRED_KEYS = ['sender-name', 'amount-pattern', 'transaction-id-pattern'] as const;

const DepositBankRegex = () => {
  const [rows, setRows] = useState<RegexConfigRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [selected, setSelected] = useState<RegexConfigRow | null>(null);

  const [bankName, setBankName] = useState('');
  const [regexJson, setRegexJson] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [actionPassword, setActionPassword] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [jsonError, setJsonError] = useState('');

  const [smsText, setSmsText] = useState('');
  const [testResult, setTestResult] = useState<{ amount?: string; txn?: string; error?: string }>(
    {}
  );

  const loadRegexConfigs = async (nextPage = page, query = search) => {
    setLoading(true);
    try {
      const data = await fetchRegexConfigs({ page: nextPage, search: query.trim() || undefined });
      setRows(Array.isArray(data.data) ? data.data : []);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load regex configs';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRegexConfigs(1);
  }, []);

  const normalizedJsonString = (value: unknown) => {
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value ?? {}, null, 2);
  };

  const formatPreview = (value: unknown) => {
    const raw = normalizedJsonString(value).replace(/\s+/g, ' ').trim();
    if (raw.length <= 60) return raw;
    return `${raw.slice(0, 60)}...`;
  };

  const validateJson = (value: string) => {
    if (!value.trim()) {
      return 'Regex JSON is required.';
    }
    if (value.length > JSON_MAX_LENGTH) {
      return 'Regex JSON exceeds 300 characters.';
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return 'Invalid JSON.';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'Invalid JSON.';
    }
    const configObj = parsed as Record<string, unknown>;
    for (const key of REQUIRED_KEYS) {
      if (typeof configObj[key] !== 'string' || !String(configObj[key]).trim()) {
        return 'Required keys are missing.';
      }
    }
    try {
      new RegExp(String(configObj['amount-pattern']), 'iu');
      new RegExp(String(configObj['transaction-id-pattern']), 'iu');
    } catch {
      return 'Regex patterns are invalid.';
    }
    return '';
  };

  const handleJsonChange = (value: string) => {
    setRegexJson(value);
    setJsonError(validateJson(value));
  };

  const resetForm = () => {
    setBankName('');
    setRegexJson('');
    setIsActive(true);
    setActionPassword('');
    setJsonError('');
  };

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const openEdit = (row: RegexConfigRow) => {
    setSelected(row);
    setBankName(row.bank_name);
    const jsonString = normalizedJsonString(row.regex_json);
    setRegexJson(jsonString);
    setJsonError(validateJson(jsonString));
    setIsActive(row.is_active);
    setActionPassword('');
    setEditOpen(true);
  };

  const openDelete = (row: RegexConfigRow) => {
    setSelected(row);
    setActionPassword('');
    setDeleteOpen(true);
  };

  const openTest = (row: RegexConfigRow) => {
    setSelected(row);
    setSmsText('');
    setTestResult({});
    setTestOpen(true);
  };

  const closeModals = () => {
    setCreateOpen(false);
    setEditOpen(false);
    setDeleteOpen(false);
    setTestOpen(false);
    setSelected(null);
  };

  const handleToggle = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleWakeup = async () => {
    setActionLoading(true);
    try {
      await wakeupRegexAcceptor();
      toast.success('Regex acceptor wakeup sent.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wakeup failed';
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  const validateForm = () => {
    if (!bankName.trim()) {
      toast.error('Bank name is required.');
      return false;
    }
    if (bankName.trim().length > 64) {
      toast.error('Bank name must be at most 64 characters.');
      return false;
    }
    const error = validateJson(regexJson);
    if (error) {
      setJsonError(error);
      toast.error(error);
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
      await createRegexConfig({
        bank_name: bankName.trim(),
        regex_json: regexJson,
        is_active: isActive,
        action_password: actionPassword,
      });
      toast.success('Regex configuration created.');
      closeModals();
      loadRegexConfigs(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed';
      toast.error(message === 'invalid_action_password' ? 'Incorrect action password.' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!selected) return;
    if (!validateForm()) return;
    setActionLoading(true);
    try {
      await updateRegexConfig(selected.id, {
        bank_name: bankName.trim(),
        regex_json: regexJson,
        is_active: isActive,
        action_password: actionPassword,
      });
      toast.success('Regex configuration updated.');
      closeModals();
      loadRegexConfigs(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      toast.error(message === 'invalid_action_password' ? 'Incorrect action password.' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    setActionLoading(true);
    try {
      await deleteRegexConfig(selected.id, { action_password: actionPassword });
      toast.success('Regex configuration deleted.');
      closeModals();
      loadRegexConfigs(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      toast.error(message === 'invalid_action_password' ? 'Incorrect action password.' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleParse = () => {
    if (!selected) return;
    const jsonString = normalizedJsonString(selected.regex_json);
    try {
      const configObj = JSON.parse(jsonString) as Record<string, string>;
      const amountRe = new RegExp(configObj['amount-pattern'], 'iu');
      const txnRe = new RegExp(configObj['transaction-id-pattern'], 'iu');
      const amountMatch = smsText.match(amountRe);
      const txnMatch = smsText.match(txnRe);
      if (!amountMatch?.[1] || !txnMatch?.[1]) {
        setTestResult({ error: 'No match' });
        return;
      }
      const amountRaw = amountMatch[1].replace(/,/g, '');
      const amountFormatted = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(amountRaw));
      setTestResult({ amount: `${amountFormatted} ETB`, txn: txnMatch[1] });
    } catch {
      setTestResult({ error: 'Invalid regex' });
    }
  };

  const onSearch = () => loadRegexConfigs(1);

  const canSubmit = useMemo(() => !validateJson(regexJson) && !actionLoading, [regexJson, actionLoading]);

  return (
    <div className="regex-page">
      <div className="regex-header">
        <div>
          <h1>Bank Regex Configurations</h1>
          <p className="regex-subtitle">Manage deposit regex parsing rules</p>
        </div>
        <div className="regex-actions">
          <button type="button" className="primary-button" onClick={openCreate}>
            Create Regex
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleWakeup}
            disabled={actionLoading}
          >
            Wake Up
          </button>
        </div>
      </div>

      <div className="regex-controls">
        <input
          type="text"
          className="regex-input"
          placeholder="Search by bank name"
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

      <div className="regex-table-wrapper">
        <table className="regex-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Bank Name</th>
              <th>Regex JSON</th>
              <th>Is Active</th>
              <th>Created At</th>
              <th>Updated At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="regex-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="regex-empty">
                  No regex configurations found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const expanded = expandedIds.has(row.id);
                return (
                  <tr key={row.id} className={expanded ? 'expanded' : ''}>
                    <td>{row.id}</td>
                    <td>{row.bank_name}</td>
                    <td>
                      <button
                        type="button"
                        className="regex-preview"
                        onClick={() => handleToggle(row.id)}
                      >
                        {formatPreview(row.regex_json)}
                      </button>
                      {expanded ? (
                        <div className="regex-expanded">
                          <pre className="regex-json">
                            {normalizedJsonString(row.regex_json)}
                          </pre>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => openTest(row)}
                          >
                            Test
                          </button>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={`regex-pill ${row.is_active ? 'active' : 'inactive'}`}>
                        {row.is_active ? '✅' : '❌'}
                      </span>
                    </td>
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
          onClick={() => loadRegexConfigs(Math.max(page - 1, 1))}
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
          onClick={() => loadRegexConfigs(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      {createOpen ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Create Bank Regex Configuration</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="regexBankName">Bank Name</label>
                <input
                  id="regexBankName"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="regexJson">Regex JSON</label>
                <textarea
                  id="regexJson"
                  value={regexJson}
                  onChange={(event) => handleJsonChange(event.target.value)}
                />
                <span className="regex-helper">
                  Paste JSON with sender-name, amount-pattern, transaction-id-pattern.
                </span>
                {jsonError ? <div className="modal-error">{jsonError}</div> : null}
              </div>
              <div className="modal-field checkbox-field">
                <label htmlFor="regexActive">
                  <input
                    id="regexActive"
                    type="checkbox"
                    checked={isActive}
                    onChange={(event) => setIsActive(event.target.checked)}
                  />
                  Is Active
                </label>
              </div>
              <div className="modal-field">
                <label htmlFor="regexPassword">Action Password</label>
                <input
                  id="regexPassword"
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
                disabled={!canSubmit}
              >
                {actionLoading ? 'Processing...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen && selected ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Edit Bank Regex — #{selected.id}</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="regexBankNameEdit">Bank Name</label>
                <input
                  id="regexBankNameEdit"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="regexJsonEdit">Regex JSON</label>
                <textarea
                  id="regexJsonEdit"
                  value={regexJson}
                  onChange={(event) => handleJsonChange(event.target.value)}
                />
                <span className="regex-helper">
                  Paste JSON with sender-name, amount-pattern, transaction-id-pattern.
                </span>
                {jsonError ? <div className="modal-error">{jsonError}</div> : null}
              </div>
              <div className="modal-field checkbox-field">
                <label htmlFor="regexActiveEdit">
                  <input
                    id="regexActiveEdit"
                    type="checkbox"
                    checked={isActive}
                    onChange={(event) => setIsActive(event.target.checked)}
                  />
                  Is Active
                </label>
              </div>
              <div className="modal-field">
                <label htmlFor="regexPasswordEdit">Action Password</label>
                <input
                  id="regexPasswordEdit"
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
                disabled={!canSubmit}
              >
                {actionLoading ? 'Processing...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteOpen && selected ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Delete Regex</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-confirmation">
                Are you sure you want to permanently delete regex for {selected.bank_name}? This may
                affect deposit parsing.
              </p>
              <div className="modal-field">
                <label htmlFor="regexDeletePassword">Action Password</label>
                <input
                  id="regexDeletePassword"
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

      {testOpen && selected ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Test Regex for {selected.bank_name}</h3>
              <button type="button" className="icon-button" onClick={closeModals} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label>Regex JSON</label>
                <pre className="regex-json">
                  {normalizedJsonString(selected.regex_json)}
                </pre>
              </div>
              <div className="modal-field">
                <label htmlFor="regexSmsText">SMS Text</label>
                <textarea
                  id="regexSmsText"
                  value={smsText}
                  onChange={(event) => setSmsText(event.target.value)}
                />
              </div>
              {testResult.error ? <div className="modal-error">{testResult.error}</div> : null}
              {!testResult.error && (testResult.amount || testResult.txn) ? (
                <div className="regex-result">
                  <div>
                    <strong>Amount:</strong> {testResult.amount}
                  </div>
                  <div>
                    <strong>Transaction ID:</strong> {testResult.txn}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeModals}>
                Close
              </button>
              <button type="button" className="primary-button" onClick={handleParse}>
                Parse
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DepositBankRegex;
