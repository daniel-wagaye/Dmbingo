import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { redeemCoupon } from '../services/couponService';

interface CouponModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function CouponModal({ onClose, onSuccess }: CouponModalProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error(t('coupon_missing'));
      return;
    }
    if (submitting) return;

    setSubmitting(true);
    try {
      const result = await redeemCoupon(trimmed);
      if (result.success) {
        onClose();
        onSuccess();
        const walletLabel = result.credit_wallet === 'withdrawal'
          ? t('withdrawal_wallet_label')
          : t('playing_wallet_label');
        toast.success(t('coupon_success', { amount: result.credited_amount, wallet: walletLabel }));
      }
    } catch (err: any) {
      if (err.status === 429) {
        toast.error(t('coupon_rate_limit'));
      } else if (err.status === 401) {
        toast.error(t('coupon_auth_error'));
      } else {
        const msg = err.data?.error || t('something_went_wrong');
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-glass" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{t('coupon_title')}</h3>

        <input
          className="modal-input"
          type="text"
          maxLength={10}
          placeholder={t('coupon_placeholder')}
          value={code}
          onChange={e => setCode(e.target.value)}
          disabled={submitting}
          autoFocus
        />

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={submitting}>
            {t('cancel')}
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !code.trim()}>
            {submitting ? <span className="spinner-sm" /> : t('coupon_claim')}
          </button>
        </div>
      </div>
    </div>
  );
}