import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { TimeSync } from '../../hooks/useAuth';
import { useGameRoom, PlayerPick } from '../../hooks/useGameRoom';
import BINGO_CARDS from '../../data/bingoCards.json';
import WinnerRevealModal from './WinnerRevealModal';
import './GameStarted.css';

interface GameStartedProps {
  telegramId: number | null;
  timeSync: TimeSync | null;
}

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const COL_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7'];
const BINGO_TIMEOUT_MS = 800;
const NO_BINGO_SUPPRESS_MS = 1500;
const AUTO_TOGGLE_TIMEOUT_MS = 5000;

function getLetterForNumber(n: number): string {
  if (n >= 1 && n <= 15) return 'B';
  if (n >= 16 && n <= 30) return 'I';
  if (n >= 31 && n <= 45) return 'N';
  if (n >= 46 && n <= 60) return 'G';
  return 'O';
}

function getColumnIndex(n: number): number {
  if (n >= 1 && n <= 15) return 0;
  if (n >= 16 && n <= 30) return 1;
  if (n >= 31 && n <= 45) return 2;
  if (n >= 46 && n <= 60) return 3;
  return 4;
}

// ── Per-board localStorage marks with gameId ──
interface DabStorage {
  gameId: number;
  boards: Record<string, { marked: number[] }>;
}

function loadDabStorage(gameId: number): DabStorage {
  try {
    const raw = localStorage.getItem('bingoDabs');
    if (raw) {
      const stored: DabStorage = JSON.parse(raw);
      if (stored.gameId === gameId) return stored;
    }
  } catch { /* ignore */ }
  return { gameId, boards: {} };
}

function saveDabStorage(storage: DabStorage): void {
  localStorage.setItem('bingoDabs', JSON.stringify(storage));
}

function getMarkedNums(storage: DabStorage, boardId: number): Set<number> {
  return new Set(storage.boards[String(boardId)]?.marked ?? []);
}

function setMarkedNums(storage: DabStorage, boardId: number, nums: Set<number>): DabStorage {
  return {
    ...storage,
    boards: { ...storage.boards, [String(boardId)]: { marked: [...nums] } },
  };
}

export default function GameStarted({ telegramId, timeSync }: GameStartedProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gameState, picks, loading, reconnect } = useGameRoom();
  const [claiming, setClaiming] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dabStorage, setDabStorage] = useState<DabStorage>({ gameId: 0, boards: {} });
  const claimingRef = useRef(false);
  const prevCalledIndexRef = useRef(0);
  const calledNumbersSnapshot = useRef<number[]>([]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await reconnect(); } finally { setRefreshing(false); }
  }, [reconnect, refreshing]);

  // Find ALL my board picks (up to 2)
  const myPicks = useMemo(() => {
    if (!telegramId) return [];
    const result: Array<{ boardId: number } & PlayerPick> = [];
    picks.forEach((pick, key) => {
      if (Number(pick.telegramId) === Number(telegramId)) {
        result.push({ boardId: Number(key), ...pick });
      }
    });
    return result;
  }, [picks, telegramId]);

  const myBoardIds = useMemo(() => myPicks.map(p => p.boardId), [myPicks]);
  const isWinner = myPicks.some(p => p.winner);

  const winners = useMemo(() => {
    const result: Array<{ boardId: number } & PlayerPick> = [];
    picks.forEach((pick, key) => {
      if (pick.winner) result.push({ boardId: Number(key), ...pick });
    });
    return result;
  }, [picks]);

  // Derive autoMode from Colyseus picks: if ANY of my picks has auto=false → OFF
  const autoMode = useMemo(() => {
    if (myPicks.length === 0) return true;
    return myPicks.every(p => p.auto);
  }, [myPicks]);

  // Load dab storage when gameId changes + reset refs for fresh reconnect
  useEffect(() => {
    const gid = gameState?.gameId ?? 0;
    if (gid > 0) {
      setDabStorage(loadDabStorage(gid));
      prevCalledIndexRef.current = 0;
      calledNumbersSnapshot.current = [];
    }
  }, [gameState?.gameId]);

  // Phase navigation
  useEffect(() => {
    if (!gameState || loading) return;
    if (gameState.phase === 'picking') navigate('/game_picking', { replace: true });
    else if (gameState.phase === 'maintenance') navigate('/maintenance', { replace: true });
    else if (gameState.phase === 'winner_reveal') {
      // Snapshot called numbers BEFORE phase changes (so modal has full data)
      const shuffled = gameState.shuffledNums || [];
      const ci = gameState.calledIndex;
      if (ci > 0 && shuffled.length > 0) {
        calledNumbersSnapshot.current = shuffled.slice(0, ci);
      }
      setShowReveal(true);
    }
  }, [gameState?.phase, loading, navigate]);

  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase !== 'winner_reveal' && gameState.phase !== 'started') setShowReveal(false);
  }, [gameState?.phase]);

  // ── Auto-dab on new called number (visual only — backend handles auto-bingo) ──
  useEffect(() => {
    if (!gameState || !gameState.callingStarted) return;
    if (gameState.phase !== 'started') return;
    const ci = gameState.calledIndex;
    if (ci <= prevCalledIndexRef.current) return;
    prevCalledIndexRef.current = ci;

    // Continuously snapshot called numbers so winner modal always has the latest
    const shuffled = gameState.shuffledNums || [];
    if (ci > 0 && shuffled.length > 0) {
      calledNumbersSnapshot.current = shuffled.slice(0, ci);
    }

    if (myBoardIds.length === 0 || !autoMode) return;
    const calledNums = new Set(shuffled.slice(0, ci));

    let updated = dabStorage;
    const cards = BINGO_CARDS as Record<string, number[][]>;

    for (const bid of myBoardIds) {
      const card = cards[String(bid)];
      if (!card) continue;
      const autoMarked = new Set<number>();
      for (const row of card) {
        for (const cell of row) {
          if (calledNums.has(cell)) autoMarked.add(cell);
        }
      }
      updated = setMarkedNums(updated, bid, autoMarked);
    }

    setDabStorage(updated);
    saveDabStorage(updated);
  }, [gameState?.calledIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle auto mode via REST endpoint
  const handleToggleAuto = useCallback(async () => {
    if (toggling) return;
    const newValue = !autoMode;
    setToggling(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTO_TOGGLE_TIMEOUT_MS);

    try {
      const res = await fetch(
        `${(import.meta as any).env.VITE_API_URL || 'http://localhost:3000'}/api/games/0/toggle-auto`,
        {
          method: 'POST',
          headers: {
            'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '',
            'X-Auto-Bingo': newValue ? 'ON' : 'OFF',
          },
          signal: controller.signal,
        }
      );
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        // Re-sync dabs when turning ON
        if (data.auto && gameState) {
          const shuffled = gameState.shuffledNums || [];
          const calledNums = new Set(shuffled.slice(0, gameState.calledIndex));
          const cards = BINGO_CARDS as Record<string, number[][]>;
          let updated = dabStorage;
          for (const bid of myBoardIds) {
            const card = cards[String(bid)];
            if (!card) continue;
            const autoMarked = new Set<number>();
            for (const row of card) {
              for (const cell of row) {
                if (calledNums.has(cell)) autoMarked.add(cell);
              }
            }
            updated = setMarkedNums(updated, bid, autoMarked);
          }
          setDabStorage(updated);
          saveDabStorage(updated);
        }
      } else if (res.status === 429) {
        toast.error(t('claim_rate_limit'));
      }
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        toast.error(t('bingo_timeout'));
      }
    } finally {
      setToggling(false);
    }
  }, [autoMode, toggling, gameState, dabStorage, myBoardIds, t]);

  // Manual dab toggle (only when auto is OFF)
  const toggleMark = useCallback((boardId: number, num: number) => {
    if (autoMode) return;
    setDabStorage(prev => {
      const current = getMarkedNums(prev, boardId);
      if (current.has(num)) current.delete(num);
      else current.add(num);
      const next = setMarkedNums(prev, boardId, current);
      saveDabStorage(next);
      return next;
    });
  }, [autoMode]);

  // ── Manual bingo claim with timeout ──
  const doClaimBingo = useCallback(async () => {
    if (!gameState || myBoardIds.length === 0 || claimingRef.current || isWinner) return;
    if (gameState.phase !== 'started') return;
    if (gameState.calledIndex < 2) {
      toast.error(t('please_wait'));
      return;
    }

    claimingRef.current = true;
    setClaiming(true);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BINGO_TIMEOUT_MS);

    try {
      const res = await fetch(
        `${(import.meta as any).env.VITE_API_URL || 'http://localhost:3000'}/api/games/0/claim-bingo`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '',
          },
          body: JSON.stringify({ board_ids: myBoardIds }),
          signal: controller.signal,
        }
      );
      clearTimeout(timer);

      if (res.status === 204) {
        // empty response
      } else if (res.ok) {
        const data = await res.json();
        if (data.action === 'no_bingo') {
          toast.error(t('no_bingo'));
          await new Promise(r => setTimeout(r, NO_BINGO_SUPPRESS_MS));
        }
      } else if (res.status === 429) {
        toast.error(t('claim_rate_limit'));
      }
    } catch (err: any) {
      clearTimeout(timer);
      if (!navigator.onLine) {
        toast.error(t('no_internet'));
      } else if (err.name === 'AbortError') {
        toast.error(t('bingo_timeout'));
      }
    } finally {
      claimingRef.current = false;
      setClaiming(false);
    }
  }, [gameState, myBoardIds, isWinner, t]);

  if (loading || !gameState) {
    return (
      <div className="game-started-page">
        <div className="started-loading"><div className="spinner" /></div>
      </div>
    );
  }

  const shuffled = gameState.shuffledNums || [];
  const calledIndex = gameState.calledIndex;
  const calledNumbers = shuffled.slice(0, calledIndex);
  const calledSet = new Set(calledNumbers);
  const currentCall = calledIndex > 0 ? shuffled[calledIndex - 1] : null;
  const recentCalls = calledNumbers.slice(-3).reverse();

  const columns: number[][] = [[], [], [], [], []];
  for (let n = 1; n <= 75; n++) {
    columns[getColumnIndex(n)].push(n);
  }

  const prize = gameState.prizeAmount ? gameState.prizeAmount.toFixed(2) : '0.00';
  const stake = gameState.stakeAmount.toFixed(2);

  const firstBoardId = myPicks[0]?.boardId;
  const secondBoardId = myPicks[1]?.boardId;
  const cards = BINGO_CARDS as Record<string, number[][]>;
  const card1 = firstBoardId ? cards[String(firstBoardId)] : null;
  const card2 = secondBoardId ? cards[String(secondBoardId)] : null;

  const renderCard = (card: number[][], boardId: number) => {
    const boardMarks = getMarkedNums(dabStorage, boardId);
    return (
      <div className="started-card-box" key={boardId}>
        <div className="started-card-headers">
          {BINGO_LETTERS.map((h, i) => (
            <span key={h} style={{ color: COL_COLORS[i] }}>{h}</span>
          ))}
        </div>
        {card.map((row: number[], ri: number) => (
          <div key={ri} className="started-card-row">
            {row.map((cell: number, ci: number) => {
              const isFree = ri === 2 && ci === 2;
              const isMarked = isFree || boardMarks.has(cell);
              let cls = 'started-card-cell';
              if (isFree) cls += ' sc-free';
              else if (isMarked) cls += ' sc-marked';
              return (
                <button
                  key={ci}
                  className={cls}
                  onClick={() => !isFree && toggleMark(boardId, cell)}
                  disabled={autoMode && !isFree}
                >
                  {isFree ? t('free') : cell}
                </button>
              );
            })}
          </div>
        ))}
        <span className="started-board-label">{t('board_number', { id: boardId })}</span>
      </div>
    );
  };

  return (
    <div className="game-started-page">
      <div className="started-stats">
        <div className="sstat-box">
          <span className="sstat-label">{t('prize')}</span>
          <span className="sstat-value sstat-prize">{prize}</span>
        </div>
        <div className="sstat-box">
          <span className="sstat-label">{t('players')}</span>
          <span className="sstat-value">{gameState.activePlayers}</span>
        </div>
        <div className="sstat-box">
          <span className="sstat-label">{t('bet')}</span>
          <span className="sstat-value">{stake}</span>
        </div>
        <div className="sstat-box">
          <span className="sstat-label">{t('call')}</span>
          <span className="sstat-value">{calledIndex}</span>
        </div>
      </div>

      <div className="started-body">
        <div className="calling-sheet">
          <div className="sheet-headers">
            {BINGO_LETTERS.map((letter, i) => (
              <span key={letter} className="sheet-header" style={{ color: COL_COLORS[i] }}>{letter}</span>
            ))}
          </div>
          <div className="sheet-grid">
            {columns.map((col, ci) => (
              <div key={ci} className="sheet-col">
                {col.map(n => {
                  const isCurrent = n === currentCall;
                  const isCalled = calledSet.has(n) && !isCurrent;
                  let cls = 'sheet-num';
                  if (isCurrent) cls += ' sheet-current';
                  else if (isCalled) cls += ' sheet-called';
                  return <span key={n} className={cls}>{n}</span>;
                })}
              </div>
            ))}
          </div>

          {/* Bingo button — under master sheet for visibility on all screen sizes */}
          {myBoardIds.length > 0 && !isWinner && (
            <button
              className="bingo-btn"
              onClick={doClaimBingo}
              disabled={claiming || autoMode}
            >
              {claiming ? <span className="spinner-sm" /> : (autoMode ? t('automatic') : t('bingo'))}
            </button>
          )}
          {isWinner && (
            <button className="bingo-btn bingo-winner" disabled>{t('winner')}</button>
          )}
          <button
            className="refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
          >
            {refreshing ? <span className="spinner-sm" /> : '↻'}
          </button>
        </div>

        <div className="started-right">
          <div className={`phase-pill ${gameState.callingStarted ? 'phase-started' : 'phase-loading'}`}>
            {gameState.callingStarted ? (
              <span>{t('started')}</span>
            ) : (
              <>
                <span className="spinner-sm" />
                <span>{t('loading')}</span>
              </>
            )}
          </div>

          {currentCall !== null && (
            <div className="current-call-box">
              <span className="current-call-label">{t('call')}</span>
              <span className="current-call-value">{getLetterForNumber(currentCall)}{currentCall}</span>
            </div>
          )}

          {recentCalls.length > 0 && (
            <div className="recent-calls">
              {recentCalls.map((n, i) => (
                <span key={i} className="recent-call-chip">{getLetterForNumber(n)}{n}</span>
              ))}
            </div>
          )}

          {/* Automatic toggle */}
          {myBoardIds.length > 0 && (
            <div className="auto-toggle-row">
              <span className="auto-toggle-label">{t('automatic')}</span>
              <button
                type="button"
                className={`auto-toggle-btn ${autoMode ? 'auto-on' : 'auto-off'}`}
                onClick={handleToggleAuto}
                disabled={toggling}
              >
                {toggling ? <span className="spinner-sm" /> : (
                  <>
                    <span className="auto-toggle-thumb" />
                    <span className="auto-toggle-text">{autoMode ? 'ON' : 'OFF'}</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Bingo cards — scrollable on small screens */}
          <div className="started-cards-scroll">
            {card1 ? (
              <>
                {renderCard(card1, firstBoardId!)}
                {card2 && renderCard(card2, secondBoardId!)}
              </>
            ) : (
              <div className="no-card-msg">{t('no_card_message')}</div>
            )}
          </div>
        </div>
      </div>

      {showReveal && gameState.phase === 'winner_reveal' && (
        <WinnerRevealModal
          gameState={gameState}
          winners={winners}
          myTelegramId={telegramId}
          calledNumbers={calledNumbersSnapshot.current.length > 0 ? calledNumbersSnapshot.current : calledNumbers}
          timeSync={timeSync}
        />
      )}
    </div>
  );
}