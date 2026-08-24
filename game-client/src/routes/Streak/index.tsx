import { useTranslation } from 'react-i18next';
import { MILESTONES, type StreakInfo } from '../../utils/streak';
import Confetti from './Confetti';
import './Streak.css';

interface StreakModalProps {
  info: StreakInfo;
  /** Bonus-day celebration burst. Only automatic openings pass this. */
  celebrate: boolean;
  onClose: () => void;
}

/** Milestones are drawn evenly spaced, so the bar fills one third per completed segment. */
function progressPercent(streak: number): number {
  if (streak <= 0) return 0;
  if (streak >= 30) return 100;
  const segment = 100 / MILESTONES.length;
  if (streak <= 5) return (streak / 5) * segment;
  if (streak <= 10) return segment + ((streak - 5) / 5) * segment;
  return segment * 2 + ((streak - 10) / 20) * segment;
}

export default function StreakModal({ info, celebrate, onClose }: StreakModalProps) {
  const { t } = useTranslation();
  const { streak, isBonusDay, nextMilestone, daysToNext, reached } = info;

  const dayUnit = streak === 1 ? t('streak_day_unit') : t('streak_days_unit');
  const showConfetti = celebrate && isBonusDay;

  return (
    <div className="modal-overlay" onClick={onClose}>
      {/* Sibling of the panel so the burst is not clipped by the modal's rounded overflow. */}
      {showConfetti ? <Confetti /> : null}

      <div
        className={`streak-modal${isBonusDay ? ' streak-modal-reward' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="streak-header">
          <h3 className="streak-title">
            <span aria-hidden="true">{isBonusDay ? '🏆' : '🔥'}</span> {t('streak_title')}
          </h3>
          <button className="streak-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="streak-content">
          {/* Hero: the current streak is the first thing the player sees. */}
          <div className="streak-hero">
            <span className="streak-hero-icon" aria-hidden="true">{isBonusDay ? '🏆' : '🔥'}</span>
            <div className="streak-hero-count">
              <span className="streak-hero-number">{streak}</span>
              <span className="streak-hero-unit">{dayUnit}</span>
            </div>

            {isBonusDay ? (
              <>
                <span className="streak-reward-badge">🎉 {t('streak_reward_earned')}</span>
                <p className="streak-hero-note">{t('streak_surprise_bonus')}</p>
                <p className="streak-hero-note">
                  {nextMilestone === null
                    ? t('streak_max_note')
                    : t('streak_keep_to_next', { days: nextMilestone })}
                </p>
              </>
            ) : (
              <p className="streak-hero-note">
                {streak === 0
                  ? t('streak_start_hint')
                  : nextMilestone === null
                    ? t('streak_max_note')
                    : t('streak_keep_going')}
              </p>
            )}
          </div>

          {/* Progress toward the next milestone */}
          <div className="streak-progress">
            <div className="streak-progress-top">
              <span className="streak-progress-label">{t('streak_progress_label')}</span>
              <span className="streak-progress-value">
                {nextMilestone === null ? `${streak}` : `${streak} / ${nextMilestone}`}
              </span>
            </div>

            <div className="streak-track">
              <div className="streak-track-fill" style={{ width: `${progressPercent(streak)}%` }} />
              {MILESTONES.map((m, i) => (
                <span
                  key={m}
                  className={`streak-node${streak >= m ? ' streak-node-done' : ''}${nextMilestone === m ? ' streak-node-next' : ''}`}
                  style={{ left: `${((i + 1) / MILESTONES.length) * 100}%` }}
                >
                  <span className="streak-node-dot" aria-hidden="true" />
                  <span className="streak-node-label">{m}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Next reward — the second-most important information after the streak itself. */}
          <div className="streak-next">
            <span className="streak-next-icon" aria-hidden="true">{nextMilestone === null ? '🏆' : '🎁'}</span>
            <div className="streak-next-body">
              <span className="streak-next-title">
                {nextMilestone === null ? t('streak_all_done') : t('streak_next_reward')}
              </span>
              {nextMilestone === null ? null : (
                <span className="streak-next-prize">{t('streak_surprise')}</span>
              )}
            </div>
            {nextMilestone !== null && daysToNext !== null ? (
              <span className="streak-next-when">
                {daysToNext === 1 ? t('streak_tomorrow') : t('streak_more_days', { days: daysToNext })}
              </span>
            ) : null}
          </div>

          {/* Milestone checklist */}
          <div className="streak-milestones">
            <span className="streak-section-title">{t('streak_milestones_title')}</span>
            <ul className="streak-milestone-list">
              {MILESTONES.map((m) => {
                const done = reached[m] || streak >= m;
                return (
                  <li
                    key={m}
                    className={`streak-milestone-row${done ? ' streak-milestone-done' : ''}${nextMilestone === m ? ' streak-milestone-next' : ''}`}
                  >
                    <span className="streak-milestone-days">
                      {m} {t('streak_days_unit')}
                    </span>
                    <span className="streak-milestone-prize">🎁 {t('streak_surprise')}</span>
                    <span className="streak-milestone-mark" aria-hidden="true">{done ? '✓' : '○'}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="streak-how">{t('streak_how_it_works')}</p>
        </div>
      </div>
    </div>
  );
}
