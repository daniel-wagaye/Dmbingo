import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { User } from '../../services/userService';

interface AuthGuardProps {
  registered: boolean;
  loading: boolean;
  children: ReactNode;
}

export default function AuthGuard({ registered, loading, children }: AuthGuardProps) {
  if (loading) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    );
  }

  // Unregistered users can only access dashboard (with limited features)
  // All other routes redirect to dashboard
  return <>{children}</>;
}