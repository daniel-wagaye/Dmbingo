import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { fetchGames, GameRow } from '../../services/gamesService';

const PHASES = ['picking', 'started', 'winner_reveal', 'error', 'maintenance', 'finished'] as const;

const formatNumber = (value: string | number | null) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numeric);
};

const gameRowClass = (phase: string | null) => {
  const value = (phase ?? '').toLowerCase();
  if (value === 'started') return 'game-row-started';
  if (value === 'error') return 'game-row-error';
  return undefined;
};

const Games = () => {
  const [rows, setRows] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadGames = async (nextPage = page) => {
    setLoading(true);
    try {
      const data = await fetchGames({
        page: nextPage,
        search: search.trim() || undefined,
        phase: phase || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      if (Array.isArray(data.data)) {
        setRows(data.data);
      }
      setPage(data.page);
      setTotalPages(data.totalPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load games';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGames(1);
  }, []);

  return (
    <div className="coupons-page">
      <div className="coupons-header">
        <div>
          <h1>Games</h1>
          <p className="coupons-subtitle">Read-only game rounds</p>
        </div>
      </div>

      <div className="coupons-controls">
        <input
          type="text"
          className="coupons-input"
          placeholder="Search game ID, phase, or stake"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') loadGames(1);
          }}
        />
        <div className="coupons-sort">
          <label>
            Phase
            <select value={phase} onChange={(event) => setPhase(event.target.value)}>
              <option value="">All</option>
              {PHASES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
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
        <button type="button" className="secondary-button" onClick={() => loadGames(1)} disabled={loading}>
          Apply Filters
        </button>
      </div>

      <div className="coupons-table-wrapper">
        <table className="coupons-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Game ID</th>
              <th>Phase</th>
              <th>Active Players</th>
              <th>Minimum Players</th>
              <th>Stake</th>
              <th>Prize</th>
              <th>House Profit</th>
              <th>Real P</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="coupons-empty">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="coupons-empty">
                  No games found.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row.game_id} className={gameRowClass(row.phase)}>
                  <td>{index + 1}</td>
                  <td>{row.game_id}</td>
                  <td>{row.phase ?? '-'}</td>
                  <td>{row.active_players ?? '-'}</td>
                  <td>{row.minimum_player ?? '-'}</td>
                  <td>{formatNumber(row.stake_amount)}</td>
                  <td>{formatNumber(row.prize_amount)}</td>
                  <td>{formatNumber(row.house_profit)}</td>
                  <td>{row.real_p ?? '-'}</td>
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
          onClick={() => loadGames(Math.max(page - 1, 1))}
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
          onClick={() => loadGames(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages || loading}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default Games;
