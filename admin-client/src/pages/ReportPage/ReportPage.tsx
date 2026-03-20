import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { AdminActionRow, fetchAdminActions } from '../../services/historyService';

const ReportPage = () => {
  const [rows, setRows] = useState<AdminActionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPayload, setSelectedPayload] = useState<{
    actionId: number;
    payload: string;
  } | null>(null);

  const loadReports = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchAdminActions({
        page: nextPage,
        search: search.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load reports';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports(1);
  }, []);

  const closePayload = () => setSelectedPayload(null);

  const formattedRows = useMemo(
    () =>
      rows.map((row) => {
        const payloadText =
          row.payload === null || row.payload === undefined
            ? ''
            : typeof row.payload === 'string'
              ? row.payload
              : JSON.stringify(row.payload, null, 2);
        const hasPayload = payloadText && payloadText !== '{}' && payloadText !== 'null';
        return { ...row, payloadText, hasPayload };
      }),
    [rows]
  );

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Reports</h1>
          <p className="coupons-subtitle">Admin action audit log</p>
        </div>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search admin, action, or target"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') loadReports(1);
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
        <button type="button" className="secondary-button" onClick={() => loadReports(1)} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Admin ID</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target Type</th>
              <th>Target ID</th>
              <th>Payload</th>
              <th>IP</th>
              <th>User Agent</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="coupons-empty">
                  Loading...
                </td>
              </tr>
            ) : formattedRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="coupons-empty">
                  No reports found.
                </td>
              </tr>
            ) : (
              formattedRows.map((row) => (
                <tr key={row.action_id}>
                  <td>{row.action_id}</td>
                  <td>{row.admin_id ?? '-'}</td>
                  <td>{row.admin_username ?? '-'}</td>
                  <td>{row.action_type}</td>
                  <td>{row.target_type ?? '-'}</td>
                  <td>{row.target_id ?? '-'}</td>
                  <td>
                    {row.hasPayload ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setSelectedPayload({ actionId: row.action_id, payload: row.payloadText })
                        }
                      >
                        View
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{row.ip ?? '-'}</td>
                  <td>{row.user_agent ?? '-'}</td>
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
          onClick={() => loadReports(Math.max(page - 1, 1))}
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
          onClick={() => loadReports(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      {selectedPayload ? (
        <div className="modal-overlay" role="presentation" onClick={closePayload}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Payload</h3>
              <button type="button" className="icon-button" onClick={closePayload} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <pre className="payload-json">{selectedPayload.payload}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ReportPage;
