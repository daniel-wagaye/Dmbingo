import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { TimeSync } from '../../hooks/useAuth';
import { useGameRoom, PlayerPick } from '../../hooks/useGameRoom';
import { apiClient } from '../../services/apiClient';
import BINGO_CARDS from '../../data/bingoCards.json';
import WinnerRevealModal from './WinnerRevealModal';
import './GameStarted.css';

interface GameStartedProps {
  telegramId: number | null;
  timeSync: TimeSync | null;
}

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const COL_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7'];

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

export default function GameStarted({ telegramId, timeSync }: GameStartedProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gameState, picks, loading } = useGameRoom();
  const [markedCells, setMarkedCells] = useState<Set<string>>(new Set());
  const [claiming, setClaiming] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  const [marksGameId, setMarksGameId] = useState<string>('');

  // Find my pick + board from Colyseus picks map
  const myPick = useMemo(() => {
    if (!telegramId) return null;
    for (const [key, pick] of picks) {
      if (Number(pick.telegramId) === Number(telegramId)) {
        return { boardId: Number(key), ...pick };
      }
    }
    return null;
  }, [picks, telegramId]);

  // Collect winners from picks map
  const winners = useMemo(() => {
    const result: Array<{ boardId: number } & PlayerPick> = [];
    picks.forEach((pick, key) => {
      if (pick.winner) result.push({ boardId: Number(key), ...pick });
    });
    return result;
  }, [picks]);

  // Load marks — use phase as proxy for "game identity" since Colyseus doesn't expose game_id
  useEffect(() => {
    const phaseKey = gameState?.phase || '';
    if (phaseKey === marksGameId) return;
    setMarksGameId(phaseKey);
    try {
      const raw = localStorage.getItem('bingoMarks');
      if (raw) {
        const stored = JSON.parse(raw);
        // Keep marks if same phase (started), clear on phase change
        if (stored.phase === 'started' && phaseKey === 'started') {
          setMarkedCells(new Set(stored.marks || []));
        } else {
          localStorage.removeItem('bingoMarks');
          setMarkedCells(new Set());
        }
      }
    } catch {
      localStorage.removeItem('bingoMarks');
      setMarkedCells(new Set());
    }
  }, [gameState?.phase]);

  // Persist marks
  useEffect(() => {
    if (!gameState || gameState.phase !== 'started') return;
    localStorage.setItem('bingoMarks', JSON.stringify({
      phase: 'started',
      marks: [...markedCells],
    }));
  }, [markedCells, gameState?.phase]);

  // Phase navigation
  useEffect(() => {
    if (!gameState || loading) return;
    if (gameState.phase === 'picking') {
      navigate('/game_picking', { replace: true });
    } else if (gameState.phase === 'maintenance') {
      navigate('/maintenance', { replace: true });
    } else if (gameState.phase === 'winner_reveal') {
      setShowReveal(true);
    }
  }, [gameState?.phase, loading, navigate]);

  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase !== 'winner_reveal' && gameState.phase !== 'started') {
      setShowReveal(false);
    }
  }, [gameState?.phase]);

  const toggleMark = useCallback((row: number, col: number) => {
    if (row === 2 && col === 2) return;
    const key = `${row}-${col}`;
    setMarkedCells(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleClaimBingo = useCallback(async () => {
    if (!gameState || !myPick || claiming) return;
    if (myPick.invalid || myPick.winner) return;

    if (gameState.calledIndex < 2) {
      toast.error(t('please_wait'));
      return;
    }

    setClaiming(true);
    try {
      await apiClient(`/api/games/0/claim-bingo`, {
        method: 'POST',
        body: { board_id: myPick.boardId },
      });
    } catch (err: any) {
      if (err.status === 429) {
        toast.error(t('claim_rate_limit'));
      }
    } finally {
      setClaiming(false);
    }
  }, [gameState, myPick, claiming, t]);

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

  const boardId = myPick?.boardId;
  const card = boardId ? (BINGO_CARDS as Record<string, number[][]>)[String(boardId)] : null;

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

          {card ? (
            <div className="started-card-box">
              <div className="started-card-headers">
                {BINGO_LETTERS.map((h, i) => (
                  <span key={h} style={{ color: COL_COLORS[i] }}>{h}</span>
                ))}
              </div>
              {card.map((row, ri) => (
                <div key={ri} className="started-card-row">
                  {row.map((cell, ci) => {
                    const isFree = ri === 2 && ci === 2;
                    const isMarked = isFree || markedCells.has(`${ri}-${ci}`);
                    let cls = 'started-card-cell';
                    if (isFree) cls += ' sc-free';
                    else if (isMarked) cls += ' sc-marked';
                    return (
                      <button key={ci} className={cls} onClick={() => toggleMark(ri, ci)}>
                        {isFree ? t('free') : cell}
                      </button>
                    );
                  })}
                </div>
              ))}
              <span className="started-board-label">{t('board_number', { id: boardId })}</span>
            </div>
          ) : (
            <div className="no-card-msg">{t('no_card_message')}</div>
          )}

          {myPick && !myPick.invalid && !myPick.winner && (
            <button className="bingo-btn" onClick={handleClaimBingo} disabled={claiming}>
              {claiming ? <span className="spinner-sm" /> : t('bingo')}
            </button>
          )}
          {myPick?.invalid && (
            <button className="bingo-btn bingo-disabled" disabled>{t('disqualified')}</button>
          )}
          {myPick?.winner && (
            <button className="bingo-btn bingo-winner" disabled>{t('winner')}</button>
          )}
        </div>
      </div>

      {showReveal && gameState.phase === 'winner_reveal' && (
        <WinnerRevealModal
          gameState={gameState}
          winners={winners}
          myTelegramId={telegramId}
          calledNumbers={calledNumbers}
          timeSync={timeSync}
        />
      )}
    </div>
  );
}