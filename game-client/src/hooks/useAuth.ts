import { useState, useEffect, useCallback } from 'react';
import i18n from 'i18next';
import { fetchUser, registerUser, User } from '../services/userService';
import '../telegram/types';

function syncLanguage(user: User): void {
  const lang = user.language === 'en' ? 'en' : 'am';
  if (i18n.language !== lang) {
    i18n.changeLanguage(lang);
  }
}

export interface TimeSync {
  serverTimeMs: number;
  perfAtFetch: number;
}

/**
 * Current time according to the server, advanced by the monotonic clock since the last fetch.
 * The device clock is only a fallback — it can be wrong by hours, which would corrupt any
 * date-based decision.
 */
export function serverNowMs(timeSync: TimeSync | null): number {
  if (!timeSync) return Date.now();
  return timeSync.serverTimeMs + (performance.now() - timeSync.perfAtFetch);
}

interface AuthState {
  user: User | null;
  registered: boolean;
  loading: boolean;
  timeSync: TimeSync | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    registered: false,
    loading: true,
    timeSync: null,
  });

  const loadUser = useCallback(async () => {
    try {
      setState((s) => ({ ...s, loading: true }));
      const data = await fetchUser();

      const perfNow = performance.now();
      const serverTime = (data as any).serverTime;
      const ts: TimeSync | null = serverTime ? { serverTimeMs: serverTime, perfAtFetch: perfNow } : null;

      if ('registered' in data && data.registered === false) {
        setState(s => ({ user: null, registered: false, loading: false, timeSync: ts || s.timeSync }));
      } else {
        const u = data as User;
        syncLanguage(u);
        setState(s => ({ user: u, registered: true, loading: false, timeSync: ts || s.timeSync }));
      }
    } catch {
      setState(s => ({ ...s, user: null, registered: false, loading: false }));
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const doRegister = useCallback(
    async (contactRaw: string): Promise<boolean> => {
      try {
        const referralCode = localStorage.getItem('referral_code') || undefined;
        const user = await registerUser(contactRaw, referralCode);
        syncLanguage(user);
        setState(s => ({ ...s, user, registered: true, loading: false }));
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const refreshUser = useCallback(async () => {
    try {
      const data = await fetchUser();
      const perfNow = performance.now();
      const serverTime = (data as any).serverTime;
      const ts: TimeSync | null = serverTime ? { serverTimeMs: serverTime, perfAtFetch: perfNow } : null;

      if ('registered' in data && data.registered === false) {
        setState(s => ({ user: null, registered: false, loading: false, timeSync: ts || s.timeSync }));
      } else {
        const u = data as User;
        syncLanguage(u);
        setState(s => ({ user: u, registered: true, loading: false, timeSync: ts || s.timeSync }));
      }
    } catch {
      // silent — don't reset state on refresh failure
    }
  }, []);

  const updateUser = useCallback((partial: Partial<User>) => {
    setState((s) => {
      if (!s.user) return s;
      return { ...s, user: { ...s.user, ...partial } };
    });
  }, []);

  return {
    user: state.user,
    registered: state.registered,
    loading: state.loading,
    timeSync: state.timeSync,
    doRegister,
    refreshUser,
    updateUser,
  };
}