import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { sendTransfer } from '../../services/transferService';
import './Transfer.css';

const PHONE_RE = /^(09|07)\d{8}$/;

interface TransferModalProps {
  withdrawableBalance: number;
  nonWithdrawableBalance: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TransferModal({
  withdrawableBalance,
  nonWithdrawableBalance,
  onClose,
  onSuccess,
}: TransferModalProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAmountChange = (val: string) => {
    const stripped = val.replace(/^0+/, '') || '';
    setAmount(stripped);
  };

  const handleSubmit = async () => {
    if (submitting) return;

    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amount.includes('.')) {
      toast.error(t('transfer_whole_number'));
      return;
    }
    if (amountNum < 10) {
      toast.error(t('transfer_min_amount'));
      return;
    }
    if (amountNum > 1000) {
      toast.error(t('transfer_max_amount'));
      return;
    }

    if (withdrawableBalance < amountNum) {
      toast.error(t('transfer_insufficient'));
      return;
    }

    const trimmedPhone = phone.trim();
    if (trimmedPhone.length !== 10 || !PHONE_RE.test(trimmedPhone)) {
      toast.error(t('transfer_invalid_phone'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await sendTransfer({
        from_wallet: 'withdrawal',
        amount: amountNum,
        recipient_phone: trimmedPhone,
      });
      if (result.success) {
        onClose();
        onSuccess();
        toast.success(t('transfer_success', {
          amount: result.amount,
          phone: result.phone,
          commission: 0,
        }));
      }
    } catch (err: any) {
      if (err.status === 429) {
        toast.error(t('transfer_rate_limit'));
      } else if (err.status === 401) {
        toast.error(t('transfer_auth_error'));
      } else if (err.status === 400) {
        const code = err.data?.error;
        if (code === 'INSUFFICIENT_BALANCE') {
          toast.error(t('transfer_insufficient'));
        } else if (code === 'USER_NOT_FOUND') {
          toast.error(t('transfer_user_not_found'));
        } else if (code === 'SELF_TRANSFER') {
          toast.error(t('transfer_self'));
        } else if (code === 'INVALID_PHONE') {
          toast.error(t('transfer_invalid_phone'));
        } else if (code === 'INVALID_AMOUNT') {
          const msg = err.data?.message || '';
          if (msg.includes('less than')) toast.error(t('transfer_max_amount'));
          else if (msg.includes('greater than')) toast.error(t('transfer_min_amount'));
          else if (msg.includes('whole')) toast.error(t('transfer_whole_number'));
          else toast.error(t('something_went_wrong'));
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
      <div className="transfer-modal" onClick={e => e.stopPropagation()}>
        <div className="transfer-header">
          <h3 className="modal-title">{t('transfer_title')}</h3>
          <button className="history-close" onClick={onClose}>✕</button>
        </div>

        {/* Wallet grid (read-only) */}
        <div className="transfer-wallets">
          <div className="transfer-wallet-item tw-green">
            <span className="tw-label">{t('transfer_wallet_withdrawal')}</span>
            <span className="tw-value">{withdrawableBalance.toFixed(2)}</span>
          </div>
          <div className="transfer-wallet-item tw-orange" style={{ display: 'none' }}>
            <span className="tw-label">{t('transfer_wallet_non_withdrawal')}</span>
            <span className="tw-value">{nonWithdrawableBalance.toFixed(2)}</span>
          </div>
        </div>

        <div className="transfer-form">
            {/* Amount */}
          <div className="transfer-field">
            <label className="transfer-label">{t('transfer_amount')}</label>
            <input
              className="modal-input"
              type="number"
              min={10}
              max={1000}
              step={1}
              placeholder={t('transfer_amount_placeholder')}
              value={amount}
              onChange={e => handleAmountChange(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Recipient phone */}
          <div className="transfer-field">
            <label className="transfer-label">{t('transfer_phone')}</label>
            <input
              className="modal-input"
              type="text"
              maxLength={10}
              placeholder={t('transfer_phone_placeholder')}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <button
          className="btn-primary transfer-submit-btn"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <span className="spinner-sm" /> : t('transfer_submit')}
        </button>
      </div>
    </div>
  );
}