import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGameRoom } from '../../hooks/useGameRoom';
import './Maintenance.css';

interface MaintenanceProps {
  telegramId: number | null;
}

export default function Maintenance({ telegramId }: MaintenanceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gameState, loading } = useGameRoom();

  useEffect(() => {
    if (!gameState || loading) return;
    if (gameState.phase === 'picking') {
      navigate('/game_picking', { replace: true });
    } else if (gameState.phase === 'started' || gameState.phase === 'winner_reveal') {
      navigate('/game_started', { replace: true });
    }
  }, [gameState?.phase, loading, navigate]);

  return (
    <div className="maintenance-page">
      <div className="glass-card maintenance-card">
        <h2 className="maintenance-title">{t('maintenance_title')}</h2>
        <p className="maintenance-subtitle">{t('maintenance_subtitle')}</p>
        <p className="maintenance-note">{t('maintenance_note')}</p>
        <button
          className="btn-primary maintenance-btn"
          onClick={() => window.open('https://t.me/DM_Bingo', '_blank')}
        >
          {t('maintenance_community')}
        </button>
      </div>
    </div>
  );
}
