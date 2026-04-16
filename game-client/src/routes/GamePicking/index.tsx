import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { TimeSync } from '../../hooks/useAuth';
import { User } from '../../services/userService';
import { useGameRoom, PlayerPick } from '../../hooks/useGameRoom';
import { apiClient } from '../../services/apiClient';
import TileGrid from './TileGrid';
import FooterPreview from './FooterPreview';
import './GamePicking.css';

const PICK_DEBOUNCE_MS = 600;

interface GamePickingProps {
  telegramId: number | null;
  timeSync: TimeSync | null;
  user: User | null;
  onRefreshUser: () => Promise<void>;
}

export default function GamePicking({ telegramId, timeSync, user, onRefreshUser }: GamePickingProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gameState, picks, reconnect } = useGameRoom();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await reconnect(); } finally { setRefreshing(false); }
  }, [reconnect, refreshing]);

  const [pendingBoardId, setPendingBoardId] = useState<number | null>(null);
  const lastPickTime = useRef(0);
  const [countdown, setCountdown] = useState('');
  const [localWallet, setLocalWallet] = useState<number>(0);
  const walletInitRef = useRef(false);

  // Initialize local wallet from user data on mount (one-time fetch)
  useEffect(() => {
    if (user && !walletInitRef.current) {
      walletInitRef.current = true;
      setLocalWallet(
        parseFloat(user.withdrawal_wallet || '0') +
        parseFloat(user.non_withdrawal_wallet || '0')
      );
    }
  }, [user]);

  // Refresh wallet when game phase changes to picking (new game created after previous ended)
  useEffect(() => {
    if (gameState?.phase === 'picking' && walletInitRef.current) {
      onRefreshUser();
    }
  }, [gameState?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync local wallet when user prop updates (from onRefreshUser)
  useEffect(() => {
    if (user) {
      setLocalWallet(
        parseFloat(user.withdrawal_wallet || '0') +
        parseFloat(user.non_withdrawal_wallet || '0')
      );
    }
  }, [user?.withdrawal_wallet, user?.non_withdrawal_wallet]);

  // Countdown using server time + performance.now()
  useEffect(() => {
    if (!gameState?.pickingEndsAt) return;

    const endsAtMs = gameState.pickingEndsAt;

    const tick = () => {
      let nowMs: number;
      if (timeSync) {
        const elapsed = performance.now() - timeSync.perfAtFetch;
        nowMs = timeSync.serverTimeMs + elapsed;
      } else {
        nowMs = Date.now();
      }
      const diffMs = endsAtMs - nowMs;
      if (diffMs <= 0) {
        setCountdown('0:00');
        return;
      }
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      setCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gameState?.pickingEndsAt, timeSync]);

  // Redirect on phase change
  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase === 'started' || gameState.phase === 'winner_reveal') {
      navigate('/game_started', { replace: true });
    } else if (gameState.phase === 'maintenance') {
      navigate('/maintenance', { replace: true });
    }
  }, [gameState?.phase, navigate]);

  // Find all my board picks (up to 2) from Colyseus picks map
  const myBoardIds = useMemo(() => {
    if (!telegramId) return [];
    const ids: number[] = [];
    for (const [key, pick] of picks) {
      if (Number(pick.telegramId) === Number(telegramId)) ids.push(Number(key));
    }
    return ids;
  }, [picks, telegramId]);

  const handleTileClick = useCallback(
    async (boardId: number) => {
      if (!gameState) return;

      const now = Date.now();
      if (now - lastPickTime.current < PICK_DEBOUNCE_MS) return;
      lastPickTime.current = now;

      setPendingBoardId(boardId);

      try {
        const result = await apiClient<any>(`/api/games/0/pick`, {
          method: 'POST',
          body: { board_id: boardId },
        });
        // Local wallet debit/refund — no DB query
        const stakeNum = gameState?.stakeAmount ?? 0;
        if (result.action === 'pick') {
          setLocalWallet(prev => prev - stakeNum);
        } else if (result.action === 'unpick') {
          setLocalWallet(prev => prev + stakeNum);
        }
        // 'move' doesn't change wallet
      } catch (err: any) {
        if (err.status === 204) {
          // silent abort
        } else if (err.status === 429) {
          toast.error(t('rate_limit_error'));
        } else if (err.status === 409) {
          const code = err.data?.error;
          if (code === 'BOARD_TAKEN') {
            toast.error(t('board_taken'));
          } else if (code === 'PICKING_CLOSED') {
            toast.error(t('picking_closed'));
          }
        } else if (err.status === 402) {
          const code = err.data?.error;
          if (code === 'ALREADY_PICKED_2_BOARD_NUMBER') {
            toast.error(t('max_2_boards'));
          } else {
            toast.error(t('insufficient_funds'));
          }
        } else if (err.status !== 204) {
          toast.error(t('server_error'));
        }
      } finally {
        setPendingBoardId(null);
      }
    },
    [gameState, t]
  );

  const stake = gameState ? gameState.stakeAmount.toFixed(2) : '0.00';

  return (
    <div className="game-picking-page">
      {/* Top stat row */}
      <div className="picking-stats">
        <div className="stat-box stat-countdown">
          <span className="stat-label">{t('countdown')}</span>
          <span className="stat-value countdown-value">{countdown}</span>
        </div>
        <button
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh"
        >
          {refreshing ? <span className="spinner-sm" /> : '↻'}
        </button>
        <div className="stat-box">
          <span className="stat-label">{t('wallet')}</span>
          <span className="stat-value">{localWallet.toFixed(2)}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">{t('stake')}</span>
          <span className="stat-value">{stake}</span>
        </div>
      </div>

      {/* Scrollable tile area */}
      <div className="picking-scroll-area">
        <TileGrid
          picks={picks}
          myTelegramId={telegramId}
          pendingBoardId={pendingBoardId}
          onTileClick={handleTileClick}
        />
      </div>

      {/* Footer bingo preview (1 or 2 cards side-by-side) */}
      {myBoardIds.length > 0 && <FooterPreview boardIds={myBoardIds} />}
    </div>
  );
}