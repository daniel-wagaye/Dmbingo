import React from 'react';
import ReactDOM from 'react-dom/client';
import { init as initTmaSdk } from '@tma.js/sdk';
import App from './App';
import './telegram/types';

// Telegram WebApp initialization
const tg = window.Telegram?.WebApp;
if (tg && tg.initData && tg.initData.length > 0) {
  tg.ready();
  tg.expand();

  // Initialize @tma.js/sdk so requestContactComplete works
  try {
    initTmaSdk();
  } catch (e) {
    console.warn('[tma.js/sdk init]', e);
  }

  // True fullscreen (Bot API 8.0+)
  if (tg.isVersionAtLeast && tg.isVersionAtLeast('8.0')) {
    try {
      tg.requestFullscreen();
    } catch {
      // requestFullscreen may not be supported on all clients
    }

    setTimeout(() => {
      document.documentElement.classList.add('tg-fullscreen');
      window.dispatchEvent(new Event('resize'));
    }, 250);
  }
} else {
  // Not launched from Telegram → redirect to info page
  if (window.location.pathname !== '/info-page') {
    window.location.replace('/info-page');
  }
}

// Save referral code from deeplink if present
// Telegram passes start_param via initDataUnsafe, not URL query params
const startParam = tg?.initDataUnsafe?.start_param;
if (startParam && /^[0-9]{1,16}$/.test(startParam)) {
  localStorage.setItem('referral_code', startParam);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
