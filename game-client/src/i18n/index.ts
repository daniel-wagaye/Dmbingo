import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import am from './am.json';

i18n.use(initReactI18next).init({
  resources: {
    am: { translation: am },
    en: { translation: en },

  },
  lng: 'am',
  fallbackLng: 'am',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
