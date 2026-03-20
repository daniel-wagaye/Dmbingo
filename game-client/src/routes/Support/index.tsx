import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './Support.css';

const SUPPORT_CONTACTS = [
  { username: 'danielwagaye', display: '@danielwagaye' },
  { username: 'Natii_lala', display: '@Natii_lala' },
];

interface SupportModalProps {
  telegramId: number | null;
  onClose: () => void;
}

export default function SupportModal({ telegramId, onClose }: SupportModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    if (!telegramId) return;
    navigator.clipboard.writeText(String(telegramId)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="support-modal" onClick={e => e.stopPropagation()}>
        <div className="support-header">
          <h3 className="modal-title">{t('support_title')}</h3>
          <button className="history-close" onClick={onClose}>✕</button>
        </div>

        {/* A) Support Contacts */}
        <div className="support-section">
          <span className="support-section-label">{t('support_contacts')}</span>
          <div className="support-contacts">
            {SUPPORT_CONTACTS.map((c) => (
              <button
                key={c.username}
                className="support-contact-card"
                onClick={() => window.open(`https://t.me/${c.username}`, '_blank')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00f2ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>{c.display}</span>
              </button>
            ))}
          </div>
        </div>

        {/* B) User Support ID */}
        <div className="support-section">
          <span className="support-section-label">{t('support_id_label')}</span>
          <div className="support-id-row">
            <span className="support-id-value">{telegramId ?? '—'}</span>
            <button
              className="support-copy-btn"
              onClick={handleCopyId}
              disabled={!telegramId}
            >
              {copied ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
          <span className="support-id-helper">{t('support_id_helper')}</span>
        </div>

        {/* C) App Usage Instructions */}
        <div className="support-section">
          <span className="support-section-label">{t('support_instructions_title')}</span>
          <div className="support-instructions">
            <div className="support-instr-item">
              <span className="support-instr-title">📱 {t('register_share_prompt').split(' ')[0]}</span>
              <p>{t('support_instr_register')}</p>
            </div>
            <div className="support-instr-item">
              <span className="support-instr-title">💰 {t('deposit')}</span>
              <p>{t('support_instr_deposit')}</p>
            </div>
            <div className="support-instr-item">
              <span className="support-instr-title">🏦 {t('withdraw')}</span>
              <p>{t('support_instr_withdraw')}</p>
            </div>
            <div className="support-instr-item">
              <span className="support-instr-title">↗ {t('transfer')}</span>
              <p>{t('support_instr_transfer')}</p>
            </div>
            <div className="support-instr-item">
              <span className="support-instr-title">🎱 {t('play')}</span>
              <p>{t('support_instr_play')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}