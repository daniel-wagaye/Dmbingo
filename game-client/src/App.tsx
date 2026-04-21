import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './hooks/useAuth';
import { useTelegramBackButton } from './hooks/useTelegramBackButton';
import AuthGuard from './routes/Auth/AuthGuard';
import Dashboard from './routes/Dashboard';
import GamePicking from './routes/GamePicking';
import GameStarted from './routes/GameStarted';
import Maintenance from './routes/Maintenance';
import './i18n';
import './App.css';

function InfoPage() {
  return (
    <div className="info-page">
      <h1>DMbingo</h1>
      <p>This app can only be accessed through Telegram. Open it from the DMbingo bot to start playing!</p>
      <a href="https://t.me/dmbingobot" target="_blank" rel="noreferrer">
        Open in Telegram
      </a>
    </div>
  );
}

function AppRoutes() {
  const { user, registered, loading, doRegister, refreshUser, updateUser, timeSync } = useAuth();
  useTelegramBackButton();

  return (
    <>
      <Toaster
        position="top-center"
        containerStyle={{
          top: 'calc(env(safe-area-inset-top, 0px) + 45px)',
        }}
        toastOptions={{
          style: {
            background: '#232a3b',
            color: '#f0f0f0',
            fontFamily: "'Poppins', sans-serif",
            fontSize: '14px',
            borderRadius: '10px',
          },
        }}
      />
      <Routes>
        <Route path="/info-page" element={<InfoPage />} />
        <Route
          path="/"
          element={
            <AuthGuard registered={registered} loading={loading}>
              <Dashboard
                user={user}
                registered={registered}
                onRegister={doRegister}
                onUserUpdate={updateUser}
                onRefreshUser={refreshUser}
              />
            </AuthGuard>
          }
        />
        <Route
          path="/game_picking"
          element={
            <AuthGuard registered={registered} loading={loading}>
              <GamePicking telegramId={user?.telegram_id ?? null} timeSync={timeSync} user={user} onRefreshUser={refreshUser} />
            </AuthGuard>
          }
        />
        <Route
          path="/game_started"
          element={
            <AuthGuard registered={registered} loading={loading}>
              <GameStarted telegramId={user?.telegram_id ?? null} timeSync={timeSync} />
            </AuthGuard>
          }
        />
        <Route
          path="/maintenance"
          element={
            <Maintenance telegramId={user?.telegram_id ?? null} />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}