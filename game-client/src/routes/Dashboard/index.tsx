import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { User } from '../../services/userService';
import { apiClient } from '../../services/apiClient';
import RegisterContact from '../Auth/RegisterContact';
import LanguageToggle from '../../components/LanguageToggle';
import EditNameModal from '../../components/EditNameModal';
import HistoryModal from '../History';
import LeaderboardModal from '../Leaderboard';
import CouponModal from '../../components/CouponModal';
import DepositModal from '../Deposit';
import WithdrawModal from '../Withdraw';
import TransferModal from '../Transfer';
import SupportModal from '../Support';
import StreakModal from '../Streak';
import { deriveStreak, markShownOn, wasShownOn } from '../../utils/streak';
import { serverNowMs, type TimeSync } from '../../hooks/useAuth';
import './Dashboard.css';

interface DashboardProps {
  user: User | null;
  registered: boolean;
  onRegister: (contactRaw: string) => Promise<boolean>;
  onUserUpdate: (partial: Partial<User>) => void;
  onRefreshUser: () => Promise<void>;
  timeSync: TimeSync | null;
}

export default function Dashboard({ user, registered, onRegister, onUserUpdate, onRefreshUser, timeSync }: DashboardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { handleRequestContact } = RegisterContact({ onRegister });
  const [showEditName, setShowEditName] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [showStreak, setShowStreak] = useState(false);
  const [streakCelebrate, setStreakCelebrate] = useState(false);
  const [lang, setLang] = useState<'en' | 'am'>((user?.language as 'en' | 'am') || 'en');
  const autoPromptedRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refetch user data on mount (handles back-button return from game pages)
  useEffect(() => {
    if (registered) {
      onRefreshUser();
    }
    return () => {
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recomputed whenever fresh user data arrives — on mount, after a wallet change, and when
  // the player returns from a game (Dashboard remounts and refetches). The EAT day comes from
  // server time, so a wrong device clock cannot break the streak or the pop-ups.
  const streakInfo = useMemo(() => deriveStreak(user, serverNowMs(timeSync)), [user, timeSync]);

  // Two automatic openings per EAT day, each guarded by its own stored date:
  // the daily reminder, and the bonus celebration for a milestone reached by today's game.
  // When both are due at once a single modal covers them and stamps both markers.
  useEffect(() => {
    if (!registered || !user) return;
    const telegramId = user.telegram_id;
    const { today, isBonusDay } = streakInfo;

    if (!wasShownOn('open', telegramId, today)) {
      markShownOn('open', telegramId, today);
      if (isBonusDay) markShownOn('bonus', telegramId, today);
      setStreakCelebrate(isBonusDay);
      setShowStreak(true);
      return;
    }

    if (isBonusDay && !wasShownOn('bonus', telegramId, today)) {
      markShownOn('bonus', telegramId, today);
      setStreakCelebrate(true);
      setShowStreak(true);
    }
  }, [registered, user, streakInfo]);

  const handleWalletChanged = () => {
    onRefreshUser();
  };

  // Manual openings never touch the automatic-popup markers and never fire confetti.
  const handleOpenStreak = () => {
    setStreakCelebrate(false);
    setShowStreak(true);
  };

  const handleCloseStreak = () => {
    setShowStreak(false);
    setStreakCelebrate(false);
  };

  const handlePlay = useCallback(async () => {
    if (!registered) {
      handleRequestContact();
      return;
    }
    if (isNavigating) return;

    setIsNavigating(true);
    try {
      const data = await apiClient<{ phase: string }>('/api/game-phase');
      const phase = data.phase;
      if (phase === 'picking') {
        navigate('/game_picking');
      } else if (phase === 'started' || phase === 'winner_reveal') {
        navigate('/game_started');
      } else if (phase === 'maintenance') {
        navigate('/maintenance');
      } else {
        toast.error(t('game_not_available'));
      }
    } catch {
      toast.error(t('game_not_available'));
    } finally {
      navTimeoutRef.current = setTimeout(() => setIsNavigating(false), 300);
    }
  }, [registered, isNavigating, navigate, handleRequestContact, t]);

  useEffect(() => {
    if (!registered && !autoPromptedRef.current) {
      autoPromptedRef.current = true;
      handleRequestContact();
    }
  }, [registered, handleRequestContact]);

  const handleProtectedAction = (action?: () => void) => {
    if (!registered) {
      handleRequestContact();
      return;
    }
    action?.();
  };

  const handleInvite = () => {
    if (!user) return;
    const link = `https://t.me/dmbingobot/startapp?startapp=${user.telegram_id}`;
    const tg = window.Telegram?.WebApp;
    if (tg) {
      // Use Telegram's share via switchInlineQuery or open link
      window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}`, '_blank');
    }
  };

  const handleLanguageChange = (newLang: 'en' | 'am') => {
    setLang(newLang);
    onUserUpdate({ language: newLang });
  };

  const handleNameUpdated = (newName: string) => {
    onUserUpdate({ first_name: newName });
  };

  const withdrawable = parseFloat(user?.withdrawal_wallet || '0');
  const nonWithdrawable = parseFloat(user?.non_withdrawal_wallet || '0');
  const total = (withdrawable + nonWithdrawable).toFixed(2);
  const displayName = (user?.first_name || 'Player').slice(0, 12);

  return (
    <div className={`dashboard-page${isNavigating ? ' dashboard-navigating' : ''}`}>
      {/* Header */}
      <header className="dash-header">
        <div className="dash-logo">DM Bingo</div>
        <div className="dash-header-actions">
          {registered && (
            <button
              className={`glass-pill streak-btn${streakInfo.isBonusDay ? ' streak-btn-bonus' : ''}`}
              onClick={handleOpenStreak}
              aria-label={t('streak_title')}
            >
              <span className="streak-btn-icon" aria-hidden="true">
                {streakInfo.isBonusDay ? '🏆' : '🔥'}
              </span>
              <span className="streak-btn-count">{streakInfo.streak}</span>
            </button>
          )}
          {registered && (
            <LanguageToggle
              currentLang={lang}
              onLanguageChange={handleLanguageChange}
            />
          )}
          {registered && (
            <button
              className="glass-pill invite-btn"
              onClick={() => handleProtectedAction(handleInvite)}
            >
              {t('invite')}
            </button>
          )}
        </div>
      </header>

      {/* Profile & Wallet Box */}
      <section className="glass-card profile-box">
        <div className="profile-top">
          <div className="greeting-row">
            <span className="greeting-text">
              {registered ? t('hi_greeting', { name: displayName }) : t('tap_to_register')}
            </span>
            {registered && (
              <button
                className="edit-name-btn"
                onClick={() => setShowEditName(true)}
                aria-label={t('edit_name')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                  <path d="m15 5 4 4"/>
                </svg>
              </button>
            )}
          </div>
          {registered && (
            <div className="profile-actions">
              <button
                className="glass-pill leaderboard-btn"
                onClick={() => handleProtectedAction(() => setShowLeaderboard(true))}
                aria-label={t('leaderboard')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
                  <path d="M4 22h16"/>
                  <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                  <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
                </svg>
                <span>{t('leaderboard')}</span>
              </button>
              <button
                className="glass-pill history-btn"
                onClick={() => handleProtectedAction(() => setShowHistory(true))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>{t('history')}</span>
              </button>
            </div>
          )}
        </div>

        <div className="balance-center">
          <svg className="wallet-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00f2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
          </svg>
          <span className="balance-amount">{total}</span>
          <span className="balance-currency">{t('etb')}</span>
        </div>

        <div className="wallet-split">
          <div className="wallet-item wallet-green">
            <span className="wallet-label">{t('withdrawable_wallet')}</span>
            <span className="wallet-value">{withdrawable.toFixed(2)}</span>
          </div>
          <div className="wallet-item wallet-orange">
            <span className="wallet-label">{t('non_withdrawable_wallet')}</span>
            <span className="wallet-value">{nonWithdrawable.toFixed(2)}</span>
          </div>
        </div>
      </section>

      {/* Claim Your Money Box */}
      <section className="glass-card claim-box">
        <span className="claim-text">{t('claim_your_money')}</span>
        <button
          className="btn-primary claim-btn"
          onClick={() => handleProtectedAction(() => setShowCoupon(true))}
        >
          {t('claim')}
        </button>
      </section>

      {/* 2x2 Navigation Grid */}
      <section className="nav-grid">
        <button className="glass-card nav-card" onClick={() => handleProtectedAction(() => setShowDeposit(true))}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00f2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span>{t('deposit')}</span>
        </button>
        <button className="glass-card nav-card" onClick={() => handleProtectedAction(() => setShowWithdraw(true))}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00f2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>{t('withdraw')}</span>
        </button>
        <button className="glass-card nav-card" onClick={() => handleProtectedAction(() => setShowTransfer(true))}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00f2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17l9.2-9.2M17 17V7H7"/>
          </svg>
          <span>{t('transfer')}</span>
        </button>
        <button className="glass-card nav-card" onClick={() => handleProtectedAction(() => setShowSupport(true))}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00f2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>{t('support')}</span>
        </button>
      </section>

      {/* Fixed Play Button */}
      <div className="play-button-wrapper">
        <button
          className="play-btn"
          onClick={handlePlay}
          disabled={isNavigating}
        >
          {isNavigating ? (
            <span className="spinner-sm" />
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          )}
        </button>
      </div>

      {/* Edit Name Modal */}
      {showEditName && user && (
        <EditNameModal
          currentName={user.first_name || ''}
          onClose={() => setShowEditName(false)}
          onNameUpdated={handleNameUpdated}
        />
      )}

      {showHistory && (
        <HistoryModal onClose={() => setShowHistory(false)} />
      )}

      {showLeaderboard && (
        <LeaderboardModal onClose={() => setShowLeaderboard(false)} />
      )}

      {showCoupon && (
        <CouponModal
          onClose={() => setShowCoupon(false)}
          onSuccess={handleWalletChanged}
        />
      )}

      {showDeposit && (
        <DepositModal
          onClose={() => setShowDeposit(false)}
          onSuccess={handleWalletChanged}
        />
      )}

      {showWithdraw && (
        <WithdrawModal
          withdrawableBalance={withdrawable}
          onClose={() => setShowWithdraw(false)}
          onSuccess={handleWalletChanged}
        />
      )}

      {showTransfer && (
        <TransferModal
          withdrawableBalance={withdrawable}
          nonWithdrawableBalance={nonWithdrawable}
          onClose={() => setShowTransfer(false)}
          onSuccess={handleWalletChanged}
        />
      )}

      {showSupport && (
        <SupportModal
          telegramId={user?.telegram_id ?? null}
          onClose={() => setShowSupport(false)}
        />
      )}

      {showStreak && registered && (
        <StreakModal
          info={streakInfo}
          celebrate={streakCelebrate}
          onClose={handleCloseStreak}
        />
      )}
    </div>
  );
}