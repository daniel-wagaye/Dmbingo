import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { requestWithdrawal } from '../../services/withdrawService';
import './Withdraw.css';

const BANKS = ['Telebirr', 'CBE', 'BOA'];
const BANK_RULES: Record<string, RegExp> = {
  CBE: /^\d{6,15}$/,
  BOA: /^\d{6,15}$/,
  Telebirr: /^09\d{8}$/,
  CBEbirr: /^(09|07)\d{8}$/,
};
const NAME_RE = /^[A-Za-z\s]{1,20}$/;

interface WithdrawModalProps {
  withdrawableBalance: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function WithdrawModal({ withdrawableBalance, onClose, onSuccess }: WithdrawModalProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [holderName, setHolderName] = useState('');
  const [bank, setBank] = useState('');
  const [accountNum, setAccountNum] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 100) {
      toast.error(t('withdraw_min_amount'));
      return;
    }

    if (withdrawableBalance < amountNum) {
      toast.error(t('withdraw_insufficient', { amount: withdrawableBalance.toFixed(2) }));
      return;
    }

    const trimmedName = holderName.trim();
    if (!trimmedName || !NAME_RE.test(trimmedName)) {
      toast.error(t('withdraw_invalid_name'));
      return;
    }

    if (!bank) {
      toast.error(t('withdraw_bank_select'));
      return;
    }

    const trimmedAccount = accountNum.trim();
    if (!trimmedAccount || !BANK_RULES[bank]?.test(trimmedAccount)) {
      toast.error(t('withdraw_invalid_account'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestWithdrawal({
        amount: amountNum,
        bank,
        account_holder_name: trimmedName,
        account_num: trimmedAccount,
      });
      if (result.success) {
        onClose();
        onSuccess();
        toast.success(t('withdraw_success'));
      }
    } catch (err: any) {
      if (err.status === 429) {
        const code = err.data?.error;
        if (code === 'PENDING_LIMIT') {
          toast.error(t('withdraw_pending_limit'));
        } else {
          toast.error(t('withdraw_rate_limit'));
        }
      } else if (err.status === 401) {
        toast.error(t('withdraw_auth_error'));
      } else if (err.status === 400) {
        const code = err.data?.error;
        if (code === 'INSUFFICIENT_WALLET') {
          toast.error(t('withdraw_insufficient_wallet'));
        } else if (code === 'INVALID_NAME') {
          toast.error(t('withdraw_invalid_name'));
        } else if (code === 'INVALID_ACCOUNT') {
          toast.error(t('withdraw_invalid_account'));
        } else if (code === 'INVALID_AMOUNT') {
          toast.error(t('withdraw_min_amount'));
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
      <div className="withdraw-modal" onClick={e => e.stopPropagation()}>
        <div className="withdraw-header">
          <h3 className="modal-title">{t('withdraw_title')}</h3>
          <button className="history-close" onClick={onClose}>✕</button>
        </div>

        <div className="withdraw-balance-row">
          {t('withdraw_balance', { amount: withdrawableBalance.toFixed(2) })}
        </div>

        <div className="withdraw-form">
          {/* Amount */}
          <div className="withdraw-field">
            <label className="withdraw-label">{t('withdraw_amount')}</label>
            <input
              className="modal-input"
              type="number"
              min={100}
              placeholder={t('withdraw_amount_placeholder')}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Account holder name */}
          <div className="withdraw-field">
            <label className="withdraw-label">{t('withdraw_holder_name')}</label>
            <input
              className="modal-input"
              type="text"
              maxLength={20}
              placeholder={t('withdraw_holder_placeholder')}
              value={holderName}
              onChange={e => setHolderName(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Bank select */}
          <div className="withdraw-field">
            <label className="withdraw-label">{t('withdraw_bank')}</label>
            <select
              className="modal-input withdraw-select"
              value={bank}
              onChange={e => setBank(e.target.value)}
              disabled={submitting}
            >
              <option value="">{t('withdraw_bank_select')}</option>
              {BANKS.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* Account number */}
          <div className="withdraw-field">
            <label className="withdraw-label">{t('withdraw_account_num')}</label>
            <input
              className="modal-input"
              type="text"
              maxLength={15}
              placeholder={t('withdraw_account_placeholder')}
              value={accountNum}
              onChange={e => setAccountNum(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <button
          className="btn-primary withdraw-submit-btn"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <span className="spinner-sm" /> : t('withdraw_submit')}
        </button>
      </div>
    </div>
  );
}