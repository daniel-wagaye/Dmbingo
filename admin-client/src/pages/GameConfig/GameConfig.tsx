import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  fetchGameConfig,
  startGameStatus,
  stopGameStatus,
  updateGameConfigField,
  updateLeaderboardSnapshots,
  wakeUpGame,
} from '../../services/gameConfigService';

type GameConfigData = {
  stake_amount: string;
  picking_countdown_end_time: number;
  minimum_player: number;
  referral_amount: string;
  referral_monthly_limit: number;
  registration_bonus: string;
  last_updated: string;
};

type GameStatusData = {
  status: 'active' | 'stopped';
  updated_at: string;
};

type ConfigField =
  | 'stake_amount'
  | 'picking_countdown_end_time'
  | 'minimum_player'
  | 'referral_amount'
  | 'referral_monthly_limit'
  | 'registration_bonus';

type ConfigCard = {
  field: ConfigField;
  label: string;
  description: string;
  value: string;
  successMessage: string;
};

const toNumberString = (value: string | number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0));

const GameConfig = () => {
  const [config, setConfig] = useState<GameConfigData | null>(null);
  const [status, setStatus] = useState<GameStatusData | null>(null);
  const [loading, setLoading] = useState(false);

  const [changeOpen, setChangeOpen] = useState(false);
  const [selectedField, setSelectedField] = useState<ConfigField | null>(null);
  const [actionPassword, setActionPassword] = useState('');
  const [newValue, setNewValue] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const [toggleOpen, setToggleOpen] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<'start' | 'stop' | null>(null);

  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotLines, setSnapshotLines] = useState<string[]>([]);

  const cards: ConfigCard[] = useMemo(() => {
    if (!config) return [];
    return [
      {
        field: 'stake_amount',
        label: 'Stake Amount',
        description: 'Amount required to join a round.',
        value: toNumberString(config.stake_amount),
        successMessage: 'successfully updated the stake amount.',
      },
      {
        field: 'picking_countdown_end_time',
        label: 'Picking Countdown',
        description: 'Seconds before picking phase ends.',
        value: String(config.picking_countdown_end_time),
        successMessage: 'successfully updated the stake amount.',
      },
      {
        field: 'minimum_player',
        label: 'Minimum Players',
        description: 'Minimum players required to start.',
        value: String(config.minimum_player),
        successMessage: 'successfully updated the minimum player.',
      },
      {
        field: 'referral_amount',
        label: 'Referral Amount',
        description: 'Reward per referral.',
        value: toNumberString(config.referral_amount),
        successMessage: 'Successfully updated the referral amount.',
      },
      {
        field: 'referral_monthly_limit',
        label: 'Referral Monthly Limit',
        description: 'Max referral rewards per month.',
        value: String(config.referral_monthly_limit),
        successMessage: 'Successfully updated the referral monthly limit.',
      },
      {
        field: 'registration_bonus',
        label: 'Registration Bonus',
        description: 'Bonus for new registrations.',
        value: toNumberString(config.registration_bonus),
        successMessage: 'Successfully updated the registration bonus.',
      },
    ];
  }, [config]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await fetchGameConfig();
      setConfig(data.config);
      setStatus(data.status);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load game config';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const openChangeModal = (field: ConfigField) => {
    setSelectedField(field);
    setActionPassword('');
    setNewValue('');
    setChangeOpen(true);
  };

  const closeChangeModal = () => {
    setChangeOpen(false);
    setSelectedField(null);
  };

  const openToggleModal = (target: 'start' | 'stop') => {
    setActionPassword('');
    setToggleTarget(target);
    setToggleOpen(true);
  };

  const closeToggleModal = () => {
    setToggleOpen(false);
    setToggleTarget(null);
  };

  const submitChange = async () => {
    if (!selectedField) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    const parsed = Number(newValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast.error('Enter a whole number.');
      return;
    }
    setActionLoading(true);
    try {
      await updateGameConfigField({
        field: selectedField,
        value: parsed,
        actionPassword,
      });
      const card = cards.find((item) => item.field === selectedField);
      if (card) toast.success(card.successMessage);
      closeChangeModal();
      loadConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      toast.error(message === 'invalid_action_password' ? 'password is not correct' : message);
    } finally {
      setActionLoading(false);
    }
  };

  const submitToggle = async () => {
    if (!toggleTarget) return;
    if (!actionPassword.trim()) {
      toast.error('Enter action password.');
      return;
    }
    setActionLoading(true);
    try {
      if (toggleTarget === 'start') {
        await startGameStatus({ actionPassword });
        toast.success('Game status is changed to ACTIVE.');
        toast.success('The game has started successfully');
      } else {
        await stopGameStatus({ actionPassword });
        toast.success('Game status is changed to STOPPED.');
      }
      closeToggleModal();
      loadConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      if (message === 'invalid_action_password') {
        toast.error('password is not correct');
      } else if (message === 'ALREADY_STARTED' || message === 'already_active') {
        toast.error('Game already started or not in maintenance.');
      } else if (message === 'GAME_STATUS_IS_NOT_ACTIVE') {
        toast.error("Game status is not active. Can't start game now.");
      } else if (message === 'RATE_LIMIT_EXCEEDED') {
        toast.error('Rate limit exceeded. Please try again later.');
      } else {
        toast.error(message);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleWakeUp = async () => {
    setActionLoading(true);
    try {
      await wakeUpGame();
      toast.success('The game has started successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      if (message === 'ALREADY_STARTED') {
        toast.error('Game already started or not in maintenance.');
      } else if (message === 'GAME_STATUS_IS_NOT_ACTIVE') {
        toast.error("Game status is not active. Can't start game now.");
      } else if (message === 'RATE_LIMIT_EXCEEDED') {
        toast.error('Rate limit exceeded. Please try again later.');
      } else {
        toast.error(message);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateSnapshots = async () => {
    setSnapshotLoading(true);
    try {
      const result = await updateLeaderboardSnapshots();
      setSnapshotLines(result.lines);
      if (result.changed) {
        toast.success('Leaderboard snapshots updated.');
      } else {
        toast.success('All leaderboard snapshots are up to date.');
      }
    } catch (error) {
      const lines = (error as Error & { data?: { lines?: string[] } }).data?.lines;
      setSnapshotLines(lines ?? []);
      const message = error instanceof Error ? error.message : 'Request failed';
      toast.error(message === 'Request failed' ? 'Snapshot update failed.' : message);
    } finally {
      setSnapshotLoading(false);
    }
  };

  return (
    <div className="gameconfig-page">
      <div className="gameconfig-header">
        <div>
          <h1>Games Config</h1>
          <p className="gameconfig-subtitle">Manage game state and configuration</p>
        </div>
      </div>

      <div className="gameconfig-toggle-card">
        <div>
          <h3>Game Status</h3>
          <p className="gameconfig-subtitle">
            {status?.status === 'active' ? 'Game Active' : 'Game Stopped'}
          </p>
        </div>
        <div className="toggle-actions">
          <label className="switch">
            <input
              type="checkbox"
              checked={status?.status === 'active'}
              onChange={() =>
                openToggleModal(status?.status === 'active' ? 'stop' : 'start')
              }
              disabled={!status || actionLoading}
            />
            <span className="slider" />
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={handleWakeUp}
            disabled={actionLoading}
          >
            Wake Up
          </button>
        </div>
      </div>

      <div className="gameconfig-toggle-card">
        <div>
          <h3>Leaderboard Snapshots</h3>
          <p className="gameconfig-subtitle">
            Checks the latest completed day, week and month and saves any that are missing.
          </p>
          {snapshotLines.length > 0 ? (
            <ul className="gameconfig-result">
              {snapshotLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="toggle-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleUpdateSnapshots}
            disabled={snapshotLoading}
          >
            {snapshotLoading ? 'Processing...' : 'Update Leaderboard Snapshots'}
          </button>
        </div>
      </div>

      <div className="gameconfig-cards">
        {loading ? (
          <div className="gameconfig-empty">Loading...</div>
        ) : (
          cards.map((card) => (
            <div key={card.field} className="gameconfig-card">
              <div>
                <h4>{card.label}</h4>
                <p>{card.description}</p>
              </div>
              <div className="gameconfig-card-footer">
                <span className="gameconfig-value">{card.value}</span>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openChangeModal(card.field)}
                >
                  Change
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {changeOpen && selectedField ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>Change {cards.find((item) => item.field === selectedField)?.label}</h3>
              <button type="button" className="icon-button" onClick={closeChangeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="configPassword">Action Password</label>
                <input
                  id="configPassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="configValue">New Value</label>
                <input
                  id="configValue"
                  type="number"
                  min="0"
                  value={newValue}
                  onChange={(event) => setNewValue(event.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeChangeModal}>
                Close
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={submitChange}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Change'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toggleOpen && toggleTarget ? (
        <div className="modal-overlay" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3>{toggleTarget === 'start' ? 'Start Game' : 'Stop Game'}</h3>
              <button type="button" className="icon-button" onClick={closeToggleModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <label htmlFor="togglePassword">Action Password</label>
                <input
                  id="togglePassword"
                  type="password"
                  value={actionPassword}
                  onChange={(event) => setActionPassword(event.target.value)}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeToggleModal}>
                Close
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={submitToggle}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : toggleTarget === 'start' ? 'Start' : 'Stop'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default GameConfig;
