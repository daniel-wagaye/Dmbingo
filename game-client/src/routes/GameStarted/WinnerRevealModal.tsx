import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TimeSync } from '../../hooks/useAuth';
import { GameRoomState, PlayerPick } from '../../hooks/useGameRoom';
import BINGO_CARDS from '../../data/bingoCards.json';

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
const COL_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7'];

interface WinnerEntry {
  boardId: number;
  telegramId: number;
  winner: boolean;
  winnerName: string;
}

interface GroupedWinner {
  telegramId: number;
  name: string;
  boardIds: number[];
  boardCount: number;
}

interface WinnerRevealModalProps {
  gameState: GameRoomState;
  winners: WinnerEntry[];
  myTelegramId: number | null;
  calledNumbers: number[];
  timeSync: TimeSync | null;
}

function findWinningPatternCells(card: number[][], calledSet: Set<number>): Set<string> {
  const patternCells = new Set<string>();
  const isMarked = (r: number, c: number) => (r === 2 && c === 2) || calledSet.has(card[r][c]);

  // Rows
  for (let r = 0; r < 5; r++) {
    let win = true;
    for (let c = 0; c < 5; c++) { if (!isMarked(r, c)) { win = false; break; } }
    if (win) for (let c = 0; c < 5; c++) patternCells.add(`${r}-${c}`);
  }
  // Columns
  for (let c = 0; c < 5; c++) {
    let win = true;
    for (let r = 0; r < 5; r++) { if (!isMarked(r, c)) { win = false; break; } }
    if (win) for (let r = 0; r < 5; r++) patternCells.add(`${r}-${c}`);
  }
  // Diagonal TL-BR
  let d1 = true;
  for (let i = 0; i < 5; i++) { if (!isMarked(i, i)) { d1 = false; break; } }
  if (d1) for (let i = 0; i < 5; i++) patternCells.add(`${i}-${i}`);
  // Diagonal TR-BL
  let d2 = true;
  for (let i = 0; i < 5; i++) { if (!isMarked(i, 4 - i)) { d2 = false; break; } }
  if (d2) for (let i = 0; i < 5; i++) patternCells.add(`${i}-${4 - i}`);
  // Four Corners
  if (isMarked(0, 0) && isMarked(0, 4) && isMarked(4, 0) && isMarked(4, 4)) {
    patternCells.add('0-0'); patternCells.add('0-4');
    patternCells.add('4-0'); patternCells.add('4-4');
  }
  return patternCells;
}

export default function WinnerRevealModal({
  gameState,
  winners,
  myTelegramId,
  calledNumbers,
  timeSync,
}: WinnerRevealModalProps) {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState('');

  useEffect(() => {
    if (!gameState.winnerRevealEndsAt) return;
    const endsAtMs = gameState.winnerRevealEndsAt;
    const tick = () => {
      let nowMs: number;
      if (timeSync) {
        nowMs = timeSync.serverTimeMs + (performance.now() - timeSync.perfAtFetch);
      } else {
        nowMs = Date.now();
      }
      const diff = endsAtMs - nowMs;
      setCountdown(diff <= 0 ? '0' : Math.ceil(diff / 1000).toString());
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gameState.winnerRevealEndsAt, timeSync]);

  const calledSet = new Set(calledNumbers);
  const hasWinners = winners.length > 0;

  // Group winners by telegramId (player can win with 1 or 2 boards)
  const grouped = useMemo(() => {
    const map = new Map<number, GroupedWinner>();
    for (const w of winners) {
      const tid = Number(w.telegramId);
      const existing = map.get(tid);
      if (existing) {
        existing.boardIds.push(w.boardId);
        existing.boardCount = existing.boardIds.length;
      } else {
        map.set(tid, {
          telegramId: tid,
          name: w.winnerName || 'Player',
          boardIds: [w.boardId],
          boardCount: 1,
        });
      }
    }
    // Sort: viewer first, then others
    const arr = [...map.values()];
    arr.sort((a, b) => {
      if (a.telegramId === Number(myTelegramId)) return -1;
      if (b.telegramId === Number(myTelegramId)) return 1;
      return 0;
    });
    return arr;
  }, [winners, myTelegramId]);

  const uniqueWinnerCount = grouped.length;

  const allWinningBoards = useMemo(() => {
    const cards = BINGO_CARDS as Record<string, number[][]>;
    const result: Array<{ boardId: number; card: number[][]; patternCells: Set<string> }> = [];
    for (const g of grouped) {
      for (const bid of g.boardIds) {
        const card = cards[String(bid)];
        if (!card) continue;
        result.push({ boardId: bid, card, patternCells: findWinningPatternCells(card, calledSet) });
      }
    }
    return result;
  }, [grouped, calledSet]);

  return (
    <div className="reveal-overlay">
      <div className="reveal-modal">
        <h2 className={`reveal-header ${hasWinners ? 'reveal-bingo' : 'reveal-gameover'}`}>
          {hasWinners ? t('bingo') : t('game_over')}
        </h2>

        {hasWinners ? (
          <p className="reveal-player-count">
            {uniqueWinnerCount} {uniqueWinnerCount === 1 ? 'Player' : 'Players'} Won! 🏆
          </p>
        ) : (
          <p className="reveal-notif">{t('no_winner_message')}</p>
        )}

        {hasWinners && (
          <>
            {/* Winner name boxes — max 2 per row, centered if single */}
            <div className={`reveal-winners-list${uniqueWinnerCount === 1 ? ' reveal-winners-list-single' : ''}`}>
              {grouped.map(g => {
                const isMe = g.telegramId === Number(myTelegramId);
                const initial = (g.name[0] || 'P').toUpperCase();
                const boardLabel = g.boardCount > 1
                  ? `#${g.boardIds.join(' & #')}`
                  : `#${g.boardIds[0]}`;
                return (
                  <div key={g.telegramId} className={`reveal-winner-box ${isMe ? 'reveal-winner-mine' : ''}`}>
                    <span className="reveal-winner-initial">{initial}</span>
                    <div className="reveal-winner-info">
                      <span className="reveal-winner-name">
                        <span style={g.boardCount > 1 ? { color: '#ff8c00', fontWeight: 700 } : undefined}>{g.boardCount > 1 ? '2x' : '1x'}</span> {g.name}
                      </span>
                      <span className="reveal-winner-boards">{boardLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="reveal-cards-scroll">
            {allWinningBoards.map(({ boardId, card, patternCells: pc }) => (
              <div className="reveal-card-wrapper" key={boardId}>
                <div className="reveal-card-headers">
                  {BINGO_LETTERS.map((h, i) => (
                    <span key={h} style={{ color: COL_COLORS[i] }}>{h}</span>
                  ))}
                </div>
                {card.map((row, ri) => (
                  <div key={ri} className="reveal-card-row">
                    {row.map((cell, ci) => {
                      const isFree = ri === 2 && ci === 2;
                      const cellKey = `${ri}-${ci}`;
                      const isPattern = pc.has(cellKey);
                      const isCalled = calledSet.has(cell);
                      let cls = 'reveal-card-cell';
                      if (isFree) cls += ' rc-free';
                      else if (isPattern) cls += ' rc-pattern';
                      else if (isCalled) cls += ' rc-called';
                      return (
                        <span key={ci} className={cls}>
                          {isFree ? t('free') : cell}
                        </span>
                      );
                    })}
                  </div>
                ))}
                <span className="reveal-card-label">
                  {t('board_number', { id: boardId })}
                </span>
              </div>
            ))}
            </div>
          </>
        )}

        <div className="reveal-countdown-bar">
          <span>{countdown}s</span>
        </div>
      </div>
    </div>
  );
}
