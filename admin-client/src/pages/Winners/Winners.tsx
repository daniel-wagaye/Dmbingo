import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { fetchWinnerHistory, exportWinnerHistory, WinnerHistoryRow } from '../../services/historyService';

const formatNumber = (value: string | number | null) =>
  value !== null && value !== undefined
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value))
    : '-';

const Winners = () => {
  const [rows, setRows] = useState<WinnerHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const loadWinners = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchWinnerHistory({
        page: nextPage,
        search: search.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRows(data.data);
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load winners';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWinners(1);
  }, []);

  const handleExportDisplayed = async () => {
    if (!startDate || !endDate) {
      toast.error('Apply a date filter first to export displayed data');
      return;
    }
    setExporting(true);
    try {
      const blob = await exportWinnerHistory({
        search: search.trim() || undefined,
        startDate,
        endDate,
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `winners-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  const handleExportManual = async () => {
    if (!exportStartDate || !exportEndDate) {
      toast.error('Select a date range');
      return;
    }
    setExporting(true);
    try {
      const blob = await exportWinnerHistory({
        startDate: exportStartDate,
        endDate: exportEndDate,
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `winners-${exportStartDate}-to-${exportEndDate}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
      setExportModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Winners</h1>
          <p className="coupons-subtitle">All game winner history</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="primary-button"
            onClick={handleExportDisplayed}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export Displayed'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setExportModalOpen(true)}
          >
            Export by Date
          </button>
        </div>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search game ID, telegram ID, board ID, or amount"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') loadWinners(1); }}
        />
        <div className="coupons-date">
          <label>
            From
            <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            To
            <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <button type="button" className="secondary-button" onClick={() => loadWinners(1)} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Game ID</th>
              <th>Telegram ID</th>
              <th>Name</th>
              <th>Board ID</th>
              <th>Credited Amount</th>
              <th>Won At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="coupons-empty">Loading...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="coupons-empty">No winners found.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.game_id ?? '-'}</td>
                  <td>{row.telegram_id ?? '-'}</td>
                  <td>{row.first_name ?? '-'}</td>
                  <td>{row.board_id ?? '-'}</td>
                  <td>{formatNumber(row.credited_amount)}</td>
                  <td>{new Date(row.won_at).toLocaleString()}</td>
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
          onClick={() => loadWinners(Math.max(page - 1, 1))}
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
          onClick={() => loadWinners(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>

      {exportModalOpen ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Export Winners by Date Range</h3>
              <button type="button" className="icon-button" onClick={() => setExportModalOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label>Start Date</label>
                <input
                  type="datetime-local"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                />
              </div>
              <div className="modal-field">
                <label>End Date</label>
                <input
                  type="datetime-local"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setExportModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleExportManual}
                disabled={exporting}
              >
                {exporting ? 'Exporting...' : 'Export CSV'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Winners;
