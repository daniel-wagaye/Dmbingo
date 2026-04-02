import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { TimeSync } from '../../hooks/useAuth';
import { useGameRoom, PlayerPick } from '../../hooks/useGameRoom';
import { hasBingoPattern } from '../../utils/bingoPatterns';
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
const AUTO_RETRY_DELAY_MS = 300;
const NO_BINGO_SUPPRESS_MS = 1500;

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
  const { gameState, picks, loading } = useGameRoom();
  const [claiming, setClaiming] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  const [autoMode, setAutoMode] = useState(() => {
    try { return localStorage.getItem('bingoAutoMode') !== 'off'; } catch { return true; }
  });
  const [dabStorage, setDabStorage] = useState<DabStorage>({ gameId: 0, boards: {} });
  const claimingRef = useRef(false);
  const autoClaimSuppressedForIndex = useRef(-1);
  const prevCalledIndexRef = useRef(0);
  const calledNumbersSnapshot = useRef<number[]>([]);

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

  // Load dab storage when gameId changes + reset refs for fresh reconnect
  useEffect(() => {
    const gid = gameState?.gameId ?? 0;
    if (gid > 0) {
      setDabStorage(loadDabStorage(gid));
      prevCalledIndexRef.current = 0;
      autoClaimSuppressedForIndex.current = -1;
      calledNumbersSnapshot.current = [];
    }
  }, [gameState?.gameId]);

  // Persist auto mode to localStorage
  useEffect(() => {
    localStorage.setItem('bingoAutoMode', autoMode ? 'on' : 'off');
  }, [autoMode]);

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

  // ── Auto-dab + auto-claim on new called number ──
  useEffect(() => {
    if (!gameState || !gameState.callingStarted || isWinner) return;
    // Stop auto-claim if game phase changed (winner_reveal, picking, maintenance)
    if (gameState.phase !== 'started') return;
    const ci = gameState.calledIndex;
    if (ci <= prevCalledIndexRef.current) return;
    prevCalledIndexRef.current = ci;

    // Continuously snapshot called numbers so winner modal always has the latest
    const shuffled = gameState.shuffledNums || [];
    if (ci > 0 && shuffled.length > 0) {
      calledNumbersSnapshot.current = shuffled.slice(0, ci);
    }

    if (myBoardIds.length === 0) return;
    const calledNums = new Set(shuffled.slice(0, ci));

    let updated = dabStorage;
    const cards = BINGO_CARDS as Record<string, number[][]>;

    for (const bid of myBoardIds) {
      const card = cards[String(bid)];
      if (!card) continue;

      if (autoMode) {
        // Auto-dab: mark only called numbers, remove uncalled manual dabs
        const autoMarked = new Set<number>();
        for (const row of card) {
          for (const cell of row) {
            if (calledNums.has(cell)) autoMarked.add(cell);
          }
        }
        updated = setMarkedNums(updated, bid, autoMarked);
      }
    }

    if (autoMode) {
      setDabStorage(updated);
      saveDabStorage(updated);
    }

    // Auto-claim: check pattern for any board
    if (autoMode && !claimingRef.current && autoClaimSuppressedForIndex.current < ci) {
      let hasPattern = false;
      for (const bid of myBoardIds) {
        const card = cards[String(bid)];
        if (!card) continue;
        const marked = getMarkedNums(updated, bid);
        if (hasBingoPattern(card, marked)) { hasPattern = true; break; }
      }
      if (hasPattern) {
        doClaimBingo(true);
      }
    }
  }, [gameState?.calledIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle auto mode: when turning ON, sync dabs to only called numbers
  const handleToggleAuto = useCallback(() => {
    setAutoMode(prev => {
      const next = !prev;
      if (next && gameState) {
        // Re-sync: only keep called number dabs
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
      return next;
    });
  }, [gameState, dabStorage, myBoardIds]);

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

  // ── Bingo claim with timeout ──
  const doClaimBingo = useCallback(async (isAuto: boolean) => {
    if (!gameState || myBoardIds.length === 0 || claimingRef.current || isWinner) return;
    // Don't claim if game is no longer in started phase
    if (gameState.phase !== 'started') return;
    if (gameState.calledIndex < 2) {
      if (!isAuto) toast.error(t('please_wait'));
      return;
    }

    claimingRef.current = true;
    setClaiming(true);

    const timeoutMs = BINGO_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

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
          if (isAuto) {
            autoClaimSuppressedForIndex.current = gameState.calledIndex;
            toast.error(t('no_bingo'));
          } else {
            toast.error(t('no_bingo'));
            await new Promise(r => setTimeout(r, NO_BINGO_SUPPRESS_MS));
          }
        }
        // winner result handled by Colyseus state change
      } else if (res.status === 429) {
        toast.error(t('claim_rate_limit'));
      }
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (isAuto) {
          toast.error(t('bingo_timeout_auto'));
          setTimeout(() => {
            claimingRef.current = false;
            setClaiming(false);
            doClaimBingo(true);
          }, AUTO_RETRY_DELAY_MS);
          return;
        } else {
          toast.error(t('bingo_timeout'));
        }
      } else if (!navigator.onLine) {
        if (isAuto) {
          toast.error(t('no_internet_auto'));
          setTimeout(() => {
            claimingRef.current = false;
            setClaiming(false);
            doClaimBingo(true);
          }, AUTO_RETRY_DELAY_MS);
          return;
        } else {
          toast.error(t('no_internet'));
        }
      }
    } finally {
      claimingRef.current = false;
      setClaiming(false);
    }
  }, [gameState, myBoardIds, isWinner, t]);

  const handleClaimBingo = useCallback(() => {
    doClaimBingo(false);
  }, [doClaimBingo]);

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
              onClick={handleClaimBingo}
              disabled={claiming || autoMode}
            >
              {claiming ? <span className="spinner-sm" /> : (autoMode ? t('automatic') : t('bingo'))}
            </button>
          )}
          {isWinner && (
            <button className="bingo-btn bingo-winner" disabled>{t('winner')}</button>
          )}
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
              >
                <span className="auto-toggle-thumb" />
                <span className="auto-toggle-text">{autoMode ? 'ON' : 'OFF'}</span>
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