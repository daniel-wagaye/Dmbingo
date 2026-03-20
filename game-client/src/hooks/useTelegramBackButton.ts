import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../telegram/types';

export function useTelegramBackButton(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const callbackRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.BackButton) return;

    const isDashboard = location.pathname === '/';

    if (isDashboard) {
      tg.BackButton.hide();
      if (callbackRef.current) {
        tg.BackButton.offClick(callbackRef.current);
        callbackRef.current = null;
      }
    } else {
      // Remove old callback before adding new one
      if (callbackRef.current) {
        tg.BackButton.offClick(callbackRef.current);
      }

      const handler = () => {
        navigate('/', { replace: true });
      };
      callbackRef.current = handler;
      tg.BackButton.onClick(handler);
      tg.BackButton.show();
    }

    return () => {
      if (callbackRef.current) {
        tg?.BackButton?.offClick(callbackRef.current);
      }
    };
  }, [location.pathname, navigate]);
}
