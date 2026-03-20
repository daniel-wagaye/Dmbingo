import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { patchLanguage } from '../services/userService';

interface LanguageToggleProps {
  currentLang: 'en' | 'am';
  onLanguageChange: (lang: 'en' | 'am') => void;
}

export default function LanguageToggle({ currentLang, onLanguageChange }: LanguageToggleProps) {
  const { t, i18n } = useTranslation();
  const [isChanging, setIsChanging] = useState(false);

  const handleToggle = async () => {
    if (isChanging) return;
    setIsChanging(true);

    const previousLang = currentLang;
    const newLang: 'en' | 'am' = currentLang === 'en' ? 'am' : 'en';

    // Optimistic update
    onLanguageChange(newLang);
    i18n.changeLanguage(newLang);

    try {
      await patchLanguage(newLang);
      toast.success(t('language_updated'));
    } catch (err: any) {
      // Revert
      onLanguageChange(previousLang);
      i18n.changeLanguage(previousLang);

      if (err?.status === 429) {
        toast.error(t('language_rate_limit'));
      } else if (err?.status === 401) {
        toast.error(t('auth_failed'));
      } else {
        toast.error(t('something_went_wrong'));
      }
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <button
      className="glass-pill lang-toggle"
      onClick={handleToggle}
      disabled={isChanging}
      aria-pressed={currentLang === 'am'}
      aria-label={t('change_language')}
    >
      {isChanging ? (
        <span className="spinner-sm" />
      ) : (
        currentLang === 'en' ? 'አማርኛ' : 'English'
      )}
    </button>
  );
}