import { useState, useEffect } from 'react';
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

interface WinnerRevealModalProps {
  gameState: GameRoomState;
  winners: WinnerEntry[];
  myTelegramId: number | null;
  calledNumbers: number[];
  timeSync: TimeSync | null;
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
        const elapsed = performance.now() - timeSync.perfAtFetch;
        nowMs = timeSync.serverTimeMs + elapsed;
      } else {
        nowMs = Date.now();
      }
      const diff = endsAtMs - nowMs;
      if (diff <= 0) {
        setCountdown('0');
        return;
      }
      setCountdown(Math.ceil(diff / 1000).toString());
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gameState.winnerRevealEndsAt, timeSync]);

  const calledSet = new Set(calledNumbers);
  const hasWinners = winners.length > 0;
  const iAmWinner = winners.some((w) => Number(w.telegramId) === Number(myTelegramId));

  const sortedWinners = [...winners].sort((a, b) => {
    if (Number(a.telegramId) === Number(myTelegramId)) return -1;
    if (Number(b.telegramId) === Number(myTelegramId)) return 1;
    return 0;
  });

  let notifMessage = '';
  if (!hasWinners) {
    notifMessage = t('no_winner_message');
  } else if (winners.length === 1) {
    if (iAmWinner) {
      notifMessage = t('you_win');
    } else {
      notifMessage = t('winner_message', { name: winners[0].winnerName || 'Player' });
    }
  } else {
    if (iAmWinner) {
      notifMessage = t('you_and_others_win', { count: winners.length - 1 });
    } else {
      notifMessage = t('others_win', {
        name: winners[0].winnerName || 'Player',
        count: winners.length - 1,
      });
    }
  }

  return (
    <div className="reveal-overlay">
      <div className="reveal-modal">
        <h2 className={`reveal-header ${hasWinners ? 'reveal-bingo' : 'reveal-gameover'}`}>
          {hasWinners ? t('bingo') : t('game_over')}
        </h2>

        <p className={`reveal-notif ${iAmWinner ? 'reveal-notif-winner' : ''}`}>
          {notifMessage}
        </p>

        {hasWinners && (
          <div className="reveal-cards-scroll">
            {sortedWinners.map((w) => {
              const card = (BINGO_CARDS as Record<string, number[][]>)[String(w.boardId)];
              if (!card) return null;
              const isMe = Number(w.telegramId) === Number(myTelegramId);
              return (
                <div key={w.boardId} className={`reveal-card-wrapper ${isMe ? 'reveal-card-mine' : ''}`}>
                  <div className="reveal-card-headers">
                    {BINGO_LETTERS.map((h, i) => (
                      <span key={h} style={{ color: COL_COLORS[i] }}>{h}</span>
                    ))}
                  </div>
                  {card.map((row, ri) => (
                    <div key={ri} className="reveal-card-row">
                      {row.map((cell, ci) => {
                        const isFree = ri === 2 && ci === 2;
                        const isCalled = calledSet.has(cell);
                        let cls = 'reveal-card-cell';
                        if (isFree) cls += ' rc-free';
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
                    {t('board_number', { id: w.boardId })}
                    {isMe && ' ★'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="reveal-countdown-bar">
          <span>{countdown}s</span>
        </div>
      </div>
    </div>
  );
}
