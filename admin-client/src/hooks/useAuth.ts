import { useCallback, useState } from 'react';
import { login, logout } from '../services/authService';

export const useAuth = () => {
  const [loading, setLoading] = useState(false);

  const signIn = useCallback(async (username: string, password: string) => {
    setLoading(true);
    try {
      const result = await login({ username, password });
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await logout();
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, signIn, signOut };
};
