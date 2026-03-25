import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { fetchBankData, validateDeposit, parseSmsForTxnReference, BankInfo } from '../../services/depositService';
import './Deposit.css';

interface DepositModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function DepositModal({ onClose, onSuccess }: DepositModalProps) {
  const { t } = useTranslation();
  const [banks, setBanks] = useState<BankInfo[]>([]);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    fetchBankData()
      .then((res) => { if (res.success) setBanks(res.banks); })
      .catch(() => {});
  }, []);

  const handleCopy = (accountNumber: string, idx: number) => {
    navigator.clipboard.writeText(accountNumber).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2500);
  };

  const handleValidate = async () => {
    if (submitting) return;
    const trimmed = input.trim();

    if (trimmed.length < 8) {
      toast.error(t('deposit_invalid_txn'));
      return;
    }

    if (trimmed.length > 550) {
      toast.error(t('deposit_invalid_sms'));
      return;
    }

    let txnReference: string;

    if (trimmed.length >= 8 && trimmed.length <= 21) {
      txnReference = trimmed;
    } else {
      const parsed = parseSmsForTxnReference(trimmed);
      if (!parsed) {
        toast.error(t('deposit_invalid_sms'));
        return;
      }
      txnReference = parsed;
    }

    setSubmitting(true);
    try {
      const result = await validateDeposit(txnReference);
      if (result.success) {
        onClose();
        onSuccess();
        toast.success(t('deposit_success', { amount: result.amount }));
      }
    } catch (err: any) {
      if (err.status === 429) {
        toast.error(t('deposit_rate_limit'));
      } else if (err.status === 401) {
        toast.error(t('deposit_auth_error'));
      } else if (err.status === 404) {
        toast.error(t('deposit_not_found'));
      } else if (err.status === 409) {
        const code = err.data?.error;
        if (code === 'ALREADY_PROCESSED') {
          toast.error(t('deposit_already_processed'));
        } else if (code === 'REJECTED') {
          toast.error(t('deposit_rejected'));
        } else {
          toast.error(t('something_went_wrong'));
        }
      } else {
        toast.error(t('something_went_wrong'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="deposit-modal" onClick={e => e.stopPropagation()}>
        <div className="deposit-header">
          <h3 className="modal-title">{t('deposit_title')}</h3>
          <button className="history-close" onClick={onClose}>✕</button>
        </div>

        {/* Bank info list */}
        <div className="deposit-banks">
          {banks.map((bank, idx) => (
            <div key={idx} className="deposit-bank-card">
              <div className="deposit-bank-info">
                <span className="deposit-bank-name">{bank.bank_name}</span>
                <span className="deposit-bank-account">{bank.account_number} - {bank.account_holder_name}</span>
              </div>
              <button
                className="deposit-copy-btn"
                onClick={() => handleCopy(bank.account_number, idx)}
              >
                {copiedIdx === idx ? (
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
          ))}
        </div>

        <p style={{ color: 'orange' }}>
          <strong style={{ paddingLeft: '50px'}}>! ከ30 ብር በታች ማስገባት የተከለከለ ነው።</strong>
        </p>
        <p style={{ color: 'orange' }}>
          <strong style={{ paddingLeft: '51px'}}>! Other ባንክ ማስገባት የተከለከለ ነው።</strong>
        </p>

        {/* SMS / txn input */}
        <textarea
          className="deposit-textarea"
          placeholder={t('deposit_placeholder')}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={submitting}
          rows={3}
        />

        {/* Validate button */}
        <button
          className="btn-primary deposit-validate-btn"
          onClick={handleValidate}
          disabled={submitting || !input.trim()}
        >
          {submitting ? <span className="spinner-sm" /> : t('deposit_validate')}
        </button>
      </div>
    </div>
  );
}