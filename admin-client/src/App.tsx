import { useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { AdminNavIcon } from './components/AdminNavIcon';
import { useAuth } from './hooks/useAuth';
import AdminCreditHistory from './pages/AdminCreditHistory/AdminCreditHistory';
import AdminManagment from './pages/AdminManagment/AdminManagment';
import Dashboard from './pages/Dashboard/Dashboard';
import CouponHistory from './pages/Coupons/CouponHistory';
import Coupons from './pages/Coupons/Coupons';
import EditCredential from './pages/EditCredential/EditCredential';
import DepositBankRegex from './pages/DepositBankRegex/DepositBankRegex';
import Deposits from './pages/Deposits/Deposits';
import GameConfig from './pages/GameConfig/GameConfig';
import Games from './pages/Games/Games';
import ManageDepositBank from './pages/ManageDepositBank/ManageDepositBank';
import ReferralHistory from './pages/ReferralHistory/ReferralHistory';
import ReportPage from './pages/ReportPage/ReportPage';
import TransferHistory from './pages/TransferHistory/TransferHistory';
import Users from './pages/Users/Users';
import Winners from './pages/Winners/Winners';
import Withdrawals from './pages/Withdrawals/Withdrawals';
import {
  forgotResendOtp,
  forgotResetPassword,
  forgotStart,
  forgotVerifyEmail,
  getMe,
} from './services/authService';

type View = 'login' | 'forgot-username' | 'forgot-email' | 'forgot-otp';

type AdminRole = 'super_admin' | 'withdrawal_admin';

type AdminLayoutProps = {
  children: React.ReactNode;
  role: AdminRole | null;
  pathname: string;
  onSignOut?: () => void;
};

const SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';

const AdminLayout = ({ children, role, pathname, onSignOut }: AdminLayoutProps) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch {
      /* ignore */
    }
    return window.matchMedia('(max-width: 900px)').matches;
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const navItems = [
    { key: 'dashboard', label: 'Dashboard', href: '/admin/dashboard', enabled: role === 'super_admin' },
    { key: 'users', label: 'Users', href: '/admin/users', enabled: role === 'super_admin' },
    { key: 'withdrawals', label: 'Withdrawals', href: '/admin/withdrawals/pending', enabled: true },
    { key: 'deposits', label: 'Deposits', href: '/admin/deposits', enabled: role === 'super_admin' },
    { key: 'game-config', label: 'Game Config', href: '/admin/game-config', enabled: role === 'super_admin' },
    { key: 'games', label: 'Games', href: '/admin/games', enabled: role === 'super_admin' },
    { key: 'banks', label: 'Bank Accounts', href: '/admin/banks', enabled: role === 'super_admin' },
    { key: 'regex', label: 'Bank Regex', href: '/admin/regex', enabled: role === 'super_admin' },
    { key: 'transfers', label: 'Transfers', href: '/admin/transfers', enabled: role === 'super_admin' },
    { key: 'referrals', label: 'Referral History', href: '/admin/referrals', enabled: role === 'super_admin' },
    {
      key: 'admin-credits',
      label: 'Admin Credits',
      href: '/admin/admin-credits',
      enabled: role === 'super_admin',
    },
    { key: 'coupons', label: 'Coupons', href: '/admin/coupons', enabled: role === 'super_admin' },
    { key: 'winners', label: 'Winners', href: '/admin/winners', enabled: role === 'super_admin' },
    { key: 'reports', label: 'Reports', href: '/admin/reports', enabled: role === 'super_admin' },
    {
      key: 'admin-management',
      label: 'Admin Management',
      href: '/admin/admin-management',
      enabled: role === 'super_admin',
    },
  ];

  return (
    <div className={`admin-layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="admin-brand">{collapsed ? 'DM' : 'DM Bingo Admin'}</div>
          <button
            type="button"
            className="admin-sidebar-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {collapsed ? (
                <polyline points="9 6 15 12 9 18" />
              ) : (
                <polyline points="15 6 9 12 15 18" />
              )}
            </svg>
          </button>
        </div>
        <nav className="admin-nav">
          {navItems.filter((item) => item.enabled).map((item) => {
            const isActive =
              item.key === 'withdrawals'
                ? pathname.startsWith('/admin/withdrawals')
                : pathname.startsWith(item.href);
            return (
              <a
                key={item.key}
                className={`admin-nav-item${isActive ? ' active' : ''}`}
                href={item.href}
                title={item.label}
                aria-label={item.label}
              >
                <AdminNavIcon name={item.key} />
                <span className="admin-nav-label">{item.label}</span>
              </a>
            );
          })}
          {role && (
            <div className="admin-nav-action">
              <EditCredential role={role} buttonClassName="primary-button admin-nav-button" />
            </div>
          )}
        </nav>
      </aside>
      <main className="admin-content">
        <div className="admin-topbar">
          <button
            type="button"
            className="admin-sidebar-toggle admin-sidebar-toggle-top"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
          <button type="button" className="secondary-button admin-signout-button" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
        {children}
      </main>
    </div>
  );
};

const App = () => {
  const { loading, signIn, signOut } = useAuth();
  const [view, setView] = useState<View>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [helperText, setHelperText] = useState('');
  const [resendAt, setResendAt] = useState<string | null>(null);
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<AdminRole | null>(null);

  const pathname = window.location.pathname;
  const isAdminRoute = pathname.startsWith('/admin');
  const isDashboardRoute = pathname.startsWith('/admin/dashboard');
  const isWithdrawalsPendingRoute = pathname.startsWith('/admin/withdrawals/pending');
  const isWithdrawalsApprovedRoute = pathname.startsWith('/admin/withdrawals/approved');
  const isUsersRoute = pathname.startsWith('/admin/users');
  const isDepositsRoute = pathname.startsWith('/admin/deposits');
  const isGameConfigRoute = pathname.startsWith('/admin/game-config');
  const isGamesRoute = pathname.startsWith('/admin/games');
  const isBanksRoute = pathname.startsWith('/admin/banks');
  const isRegexRoute = pathname.startsWith('/admin/regex');
  const isCouponsRoute = pathname === '/admin/coupons';
  const isCouponHistoryRoute = pathname === '/admin/coupons/history';
  const isTransferHistoryRoute = pathname.startsWith('/admin/transfers');
  const isReferralHistoryRoute = pathname.startsWith('/admin/referrals');
  const isAdminCreditHistoryRoute = pathname.startsWith('/admin/admin-credits');
  const isWinnersRoute = pathname.startsWith('/admin/winners');
  const isReportsRoute = pathname.startsWith('/admin/reports');
  const isAdminManagementRoute = pathname.startsWith('/admin/admin-management');

  const resendCountdown = useMemo(() => {
    if (!resendAt) return 0;
    const diff = new Date(resendAt).getTime() - Date.now();
    return Math.max(Math.ceil(diff / 1000), 0);
  }, [resendAt]);

  const otpCountdown = useMemo(() => {
    if (!otpExpiresAt) return 0;
    const diff = new Date(otpExpiresAt).getTime() - Date.now();
    return Math.max(Math.ceil(diff / 1000), 0);
  }, [otpExpiresAt]);

  useEffect(() => {
    if (!resendAt && !otpExpiresAt) return;
    const timer = setInterval(() => {
      setResendAt((prev) => prev);
      setOtpExpiresAt((prev) => prev);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt, otpExpiresAt]);

  useEffect(() => {
    if (!isAdminRoute) {
      setAuthChecked(true);
      return;
    }
    let mounted = true;
    getMe()
      .then((result) => {
        if (!mounted) return;
        setIsAuthenticated(true);
        setRole(result.role as AdminRole);
        setAuthChecked(true);
      })
      .catch(() => {
        if (!mounted) return;
        setIsAuthenticated(false);
        setRole(null);
        setAuthChecked(true);
      });
    return () => {
      mounted = false;
    };
  }, [isAdminRoute]);

  const resetForgotState = () => {
    setEmail('');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setHelperText('');
    setResendAt(null);
    setOtpExpiresAt(null);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await signIn(username.trim(), password);
      window.location.href = result.redirect;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      toast.error(message === 'invalid_credentials' ? 'Invalid username or password.' : message);
    }
  };

  const handleForgotStart = async (event: React.FormEvent) => {
    event.preventDefault();
    setHelperText('');
    try {
      const result = await forgotStart({ username: username.trim() });
      if (result.status === 'locked_withdrawal_admin') {
        setHelperText('Please reach out to Super Admin for reactivation.');
        return;
      }
      if (result.status === 'active_withdrawal_admin') {
        toast.error('Please contact Support');
        return;
      }
      setView('forgot-email');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      if (message === 'unknown_username') {
        toast.error('Unknown Username!');
        return;
      }
      toast.error(message);
    }
  };

  const handleForgotVerifyEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await forgotVerifyEmail({
        username: username.trim(),
        email: email.trim(),
      });
      toast.success('A verification code has been sent to your email address.');
      setOtpExpiresAt(result.expiresAt);
      setResendAt(result.nextResendAllowedAt);
      setView('forgot-otp');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      if (message === 'email_mismatch') {
        toast.success('A Link is send to Your email Adress seccesfully');
        return;
      }
      toast.error(message);
    }
  };

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const passwordPolicy = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}$/;
    if (!passwordPolicy.test(newPassword)) {
      toast.error('Use 12+ chars with upper, lower, number, and symbol.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Login passwords do not match.');
      return;
    }
    try {
      const result = await forgotResetPassword({
        username: username.trim(),
        otp: otp.trim(),
        newPassword,
      });
      toast.success('Password updated — redirecting...');
      window.location.href = result.redirect;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      const data = (error as Error & { data?: { attempts_left?: number } }).data;
      if (message === 'invalid_otp') {
        const attemptsLeft = data?.attempts_left ?? 0;
        toast.error(`Invalid code. ${attemptsLeft} attempts left.`);
        return;
      }
      if (message === 'otp_expired') {
        toast.error('Code expired — please resend.');
        return;
      }
      if (message === 'too_many_attempts') {
        toast.error('Too many attempts.');
        return;
      }
      if (message === 'weak_password') {
        toast.error('Use 12+ chars with upper, lower, number, and symbol.');
        return;
      }
      toast.error(message);
    }
  };

  const handleResendOtp = async () => {
    try {
      const result = await forgotResendOtp({ username: username.trim() });
      setResendAt(result.nextResendAllowedAt);
      setOtpExpiresAt(new Date(Date.now() + 5 * 60 * 1000).toISOString());
      toast.success('A verification code has been sent to your email address.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      const data = (error as Error & { data?: { next_resend_allowed_at?: string } }).data;
      if (message === 'cooldown') {
        if (data?.next_resend_allowed_at) {
          setResendAt(data.next_resend_allowed_at);
        }
        return;
      }
      if (message === 'too_many_attempts') {
        toast.error('Too many attempts.');
        return;
      }
      toast.error(message);
    }
  };

  const startForgotFlow = () => {
    resetForgotState();
    setView('forgot-username');
  };

  const backToLogin = () => {
    resetForgotState();
    setView('login');
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      window.location.href = '/admin/login';
    }
  };

  if (isAdminRoute && !authChecked) {
    return (
      <div className="auth-page">
        <Toaster position="top-right" />
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-title">DM Bingo Admin</div>
            <div className="auth-subtitle">Checking session...</div>
          </div>
        </div>
      </div>
    );
  }

  if (isAdminRoute && isAuthenticated) {
    if (isDashboardRoute) {
      if (role !== 'super_admin') {
        window.location.href = '/admin/withdrawals/pending';
        return null;
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <Dashboard />
        </AdminLayout>
      );
    }

    if (isWithdrawalsPendingRoute) {
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <Withdrawals mode="pending" />
        </AdminLayout>
      );
    }

    if (isWithdrawalsApprovedRoute) {
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <Withdrawals mode="history" />
        </AdminLayout>
      );
    }

    if (isUsersRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <Users />
        </AdminLayout>
      );
    }

    if (isDepositsRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <Deposits />
        </AdminLayout>
      );
    }

    if (isGameConfigRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <GameConfig />
        </AdminLayout>
      );
    }

    if (isGamesRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <Games />
        </AdminLayout>
      );
    }

    if (isBanksRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <ManageDepositBank />
        </AdminLayout>
      );
    }

    if (isRegexRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <DepositBankRegex />
        </AdminLayout>
      );
    }

    if (isCouponsRoute || isCouponHistoryRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          {isCouponHistoryRoute ? <CouponHistory /> : <Coupons />}
        </AdminLayout>
      );
    }

    if (isTransferHistoryRoute || isReferralHistoryRoute || isAdminCreditHistoryRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          {isTransferHistoryRoute ? (
            <TransferHistory />
          ) : isReferralHistoryRoute ? (
            <ReferralHistory />
          ) : (
            <AdminCreditHistory />
          )}
        </AdminLayout>
      );
    }

    if (isWinnersRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <Winners />
        </AdminLayout>
      );
    }

    if (isReportsRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <ReportPage />
        </AdminLayout>
      );
    }

    if (isAdminManagementRoute) {
      if (role !== 'super_admin') {
        return (
          <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
            <Toaster position="top-right" />
            <div className="page-placeholder">
              <h2>Access denied</h2>
              <p>Super Admin access only.</p>
            </div>
          </AdminLayout>
        );
      }
      return (
        <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
          <Toaster position="top-right" />
          <AdminManagment />
        </AdminLayout>
      );
    }

    return (
      <AdminLayout role={role} pathname={pathname} onSignOut={handleSignOut}>
        <Toaster position="top-right" />
        <div className="page-placeholder">
          <h2>Admin Area</h2>
          <p>This page is not available yet.</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <div className="auth-page">
      <Toaster position="top-right" />
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-title">DM Bingo Admin</div>
          <div className="auth-subtitle">Secure access for authorized staff</div>
        </div>

        {view === 'login' && (
          <form className="auth-form" onSubmit={handleLogin}>
            <label className="auth-label">
              Username
              <input
                className="auth-input"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoComplete="username"
              />
            </label>
            <label className="auth-label">
              Password
              <input
                className="auth-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            <button className="auth-button" type="submit" disabled={loading}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
            <button className="auth-link" type="button" onClick={startForgotFlow}>
              Forgot Password?
            </button>
          </form>
        )}

        {view === 'forgot-username' && (
          <form className="auth-form" onSubmit={handleForgotStart}>
            <label className="auth-label">
              Username
              <input
                className="auth-input"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            {helperText && <div className="helper-text">{helperText}</div>}
            <button className="auth-button" type="submit">
              Continue
            </button>
            <button className="auth-link" type="button" onClick={backToLogin}>
              Back to login
            </button>
          </form>
        )}

        {view === 'forgot-email' && (
          <form className="auth-form" onSubmit={handleForgotVerifyEmail}>
            <label className="auth-label">
              Enter your current email address
              <input
                className="auth-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <button className="auth-button" type="submit">
              Send Code
            </button>
            <button className="auth-link" type="button" onClick={backToLogin}>
              Back to login
            </button>
          </form>
        )}

        {view === 'forgot-otp' && (
          <form className="auth-form" onSubmit={handleResetPassword}>
            <label className="auth-label">
              Enter verification code
              <input
                className="auth-input"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
            </label>
            <label className="auth-label">
              New login password
              <input
                className="auth-input"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                autoComplete="new-password"
              />
            </label>
            <label className="auth-label">
              Confirm login password
              <input
                className="auth-input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                autoComplete="new-password"
              />
            </label>
            <button className="auth-button" type="submit">
              Update Password
            </button>
            <div className="auth-meta">
              <span className="auth-meta-text">
                {otpCountdown > 0 ? `Code expires in ${otpCountdown}s` : 'Code expired'}
              </span>
              <button
                type="button"
                className="auth-link inline"
                onClick={handleResendOtp}
                disabled={resendCountdown > 0}
              >
                {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : "Didn't get it? Resend"}
              </button>
            </div>
            <button className="auth-link" type="button" onClick={backToLogin}>
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default App;
