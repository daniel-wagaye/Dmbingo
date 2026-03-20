import { useCallback } from 'react';
import { requestContactComplete } from '@tma.js/sdk';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface RegisterContactProps {
  onRegister: (contactRaw: string) => Promise<boolean>;
}

export default function RegisterContact({ onRegister }: RegisterContactProps) {
  const { t } = useTranslation();

  const handleRequestContact = useCallback(async () => {
    try {
      const result = await requestContactComplete();

      if (!result || !result.raw) {
        toast.error(t('register_share_prompt'));
        return;
      }

      const success = await onRegister(result.raw);
      if (success) {
        toast.success(t('welcome_toast'));
      } else {
        toast.error(t('registration_failed'));
      }
    } catch {
      toast.error(t('register_share_prompt'));
    }
  }, [onRegister, t]);

  return { handleRequestContact };
}