import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import toast from 'react-hot-toast';
import {
  sendSuperAdminEmailOtp,
  sendSuperAdminPasswordOtp,
  updateSuperAdminEmail,
  updateSuperAdminPassword,
  updateWithdrawalAdminPassword,
} from '../../services/credentialService';

type Role = 'super_admin' | 'withdrawal_admin';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatCountdown = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.max(seconds % 60, 0)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

const getRemainingSeconds = (timestamp: string | null) => {
  if (!timestamp) return 0;
  const remaining = Math.ceil((new Date(timestamp).getTime() - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
};

const getPasswordErrors = (value: string) => {
  const errors: string[] = [];
  if (!value) return errors;
  if (value.length < 8) errors.push('Password must be at least 8 characters.');
  if (!/[a-z]/.test(value)) errors.push('Password must include a lowercase letter.');
  if (!/[A-Z]/.test(value)) errors.push('Password must include an uppercase letter.');
  if (!/\d/.test(value)) errors.push('Password must include a number.');
  if (!/[^A-Za-z\d]/.test(value)) errors.push('Password must include a symbol.');
  return errors;
};

const getFocusableElements = (root: HTMLElement | null) => {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
};

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="password-toggle-icon">
    <path
      fill="currentColor"
      d="M12 5c-5.05 0-9.27 3.11-11 7 1.73 3.89 5.95 7 11 7s9.27-3.11 11-7c-1.73-3.89-5.95-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
    />
  </svg>
);

const EditCredential = ({
  role,
  buttonClassName = 'primary-button',
}: {
  role: Role | null;
  buttonClassName?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [superMode, setSuperMode] = useState<'login' | 'action' | 'email'>('login');
  const [withdrawalMode, setWithdrawalMode] = useState<'login' | 'action'>('login');

  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [passwordOtpSent, setPasswordOtpSent] = useState(false);
  const [passwordOtpExpiresAt, setPasswordOtpExpiresAt] = useState<string | null>(null);
  const [passwordResendAt, setPasswordResendAt] = useState<string | null>(null);

  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [currentEmailOtp, setCurrentEmailOtp] = useState('');
  const [newEmailOtp, setNewEmailOtp] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpExpiresAt, setEmailOtpExpiresAt] = useState<string | null>(null);
  const [emailResendAt, setEmailResendAt] = useState<string | null>(null);

  const [currentActionPassword, setCurrentActionPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showCurrentActionPassword, setShowCurrentActionPassword] = useState(false);

  const [isSending, setIsSending] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);

  const isSuperAdmin = role === 'super_admin';
  const isWithdrawalAdmin = role === 'withdrawal_admin';

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        firstRadioRef.current?.focus();
      }, 0);
    }
  }, [isOpen, role]);

  useEffect(() => {
    if (!isOpen) return;
    const handleFocus = (event: FocusEvent) => {
      if (!modalRef.current) return;
      if (!modalRef.current.contains(event.target as Node)) {
        const focusables = getFocusableElements(modalRef.current);
        focusables[0]?.focus();
      }
    };
    document.addEventListener('focusin', handleFocus);
    return () => document.removeEventListener('focusin', handleFocus);
  }, [isOpen]);

  const resetState = () => {
    setSuperMode('login');
    setWithdrawalMode('login');
    setEmail('');
    setNewPassword('');
    setConfirmPassword('');
    setOtp('');
    setPasswordOtpSent(false);
    setPasswordOtpExpiresAt(null);
    setPasswordResendAt(null);
    setCurrentEmail('');
    setNewEmail('');
    setCurrentEmailOtp('');
    setNewEmailOtp('');
    setEmailOtpSent(false);
    setEmailOtpExpiresAt(null);
    setEmailResendAt(null);
    setCurrentActionPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setShowCurrentActionPassword(false);
    setIsSending(false);
    setIsUpdating(false);
  };

  const closeModal = () => {
    setIsOpen(false);
    resetState();
  };

  const passwordErrors = useMemo(() => getPasswordErrors(newPassword), [newPassword]);
  const confirmError =
    !!confirmPassword && !!newPassword && confirmPassword !== newPassword
      ? 'Passwords do not match.'
      : '';
  const emailValid = EMAIL_REGEX.test(email.trim());
  const currentEmailValid = EMAIL_REGEX.test(currentEmail.trim());
  const newEmailValid = EMAIL_REGEX.test(newEmail.trim());
  const otpValid = otp.trim().length === 6;
  const currentOtpValid = currentEmailOtp.trim().length === 6;
  const newOtpValid = newEmailOtp.trim().length === 6;
  const currentEmailDescribedBy =
    !currentEmailValid && currentEmail ? 'current-email-hint current-email-error' : 'current-email-hint';

  const canSendPasswordOtp =
    emailValid && passwordErrors.length === 0 && !confirmError && newPassword.length > 0;
  const canUpdatePassword =
    canSendPasswordOtp && otpValid && passwordOtpSent && !isUpdating && !isSending;

  const canSendEmailOtp =
    currentEmailValid &&
    newEmailValid &&
    currentEmail.trim().toLowerCase() !== newEmail.trim().toLowerCase();
  const canUpdateEmail =
    canSendEmailOtp && currentOtpValid && newOtpValid && emailOtpSent && !isUpdating && !isSending;

  const canUpdateWithdrawal =
    !!currentActionPassword &&
    passwordErrors.length === 0 &&
    !confirmError &&
    newPassword.length > 0 &&
    !isUpdating &&
    !isSending;

  const passwordCountdown = useMemo(() => {
    if (!passwordOtpExpiresAt) return null;
    const remaining = Math.floor((new Date(passwordOtpExpiresAt).getTime() - Date.now()) / 1000);
    return remaining > 0 ? formatCountdown(remaining) : null;
  }, [passwordOtpExpiresAt]);

  const emailCountdown = useMemo(() => {
    if (!emailOtpExpiresAt) return null;
    const remaining = Math.floor((new Date(emailOtpExpiresAt).getTime() - Date.now()) / 1000);
    return remaining > 0 ? formatCountdown(remaining) : null;
  }, [emailOtpExpiresAt]);

  const passwordResendRemaining = useMemo(
    () => getRemainingSeconds(passwordResendAt),
    [passwordResendAt]
  );
  const emailResendRemaining = useMemo(() => getRemainingSeconds(emailResendAt), [emailResendAt]);

  useEffect(() => {
    if (!passwordOtpExpiresAt) return;
    const interval = setInterval(() => {
      setPasswordOtpExpiresAt((prev) => prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [passwordOtpExpiresAt]);

  useEffect(() => {
    if (!emailOtpExpiresAt) return;
    const interval = setInterval(() => {
      setEmailOtpExpiresAt((prev) => prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [emailOtpExpiresAt]);

  useEffect(() => {
    if (!passwordResendAt) return;
    const interval = setInterval(() => {
      setPasswordResendAt((prev) => prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [passwordResendAt]);

  useEffect(() => {
    if (!emailResendAt) return;
    const interval = setInterval(() => {
      setEmailResendAt((prev) => prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [emailResendAt]);

  const handleSendPasswordOtp = async () => {
    if (!isSuperAdmin || isSending) return;
    if (passwordResendRemaining > 0) {
      toast.error(`Please wait ${passwordResendRemaining} seconds.`);
      return;
    }
    if (!canSendPasswordOtp) {
      toast.error('Please complete all fields with valid values.');
      return;
    }
    setIsSending(true);
    try {
      const data = await sendSuperAdminPasswordOtp({
        credentialType: superMode === 'action' ? 'action' : 'login',
        email: email.trim(),
        newPassword,
        confirmPassword,
      });
      setPasswordOtpSent(true);
      setPasswordOtpExpiresAt(data.expiresAt);
      setPasswordResendAt(data.nextResendAllowedAt);
      toast.success('Verification code sent.');
    } catch (error) {
      const err = error as Error & {
        data?: { error?: string; next_resend_allowed_at?: string; nextResendAllowedAt?: string };
      };
      if (err.data?.error === 'cooldown') {
        const nextAt = err.data.next_resend_allowed_at ?? err.data.nextResendAllowedAt;
        if (nextAt) {
          const remaining = getRemainingSeconds(nextAt);
          setPasswordResendAt(nextAt);
          toast.error(`Please wait ${remaining} seconds.`);
          return;
        }
      }
      const message = error instanceof Error ? error.message : 'Failed to send code';
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!isSuperAdmin || isUpdating) return;
    if (!canUpdatePassword) {
      toast.error('Please complete all fields with valid values.');
      return;
    }
    setIsUpdating(true);
    try {
      await updateSuperAdminPassword({
        credentialType: superMode === 'action' ? 'action' : 'login',
        email: email.trim(),
        newPassword,
        confirmPassword,
        otp: otp.trim(),
      });
      toast.success(
        `Your ${superMode === 'action' ? 'action' : 'login'} password has been updated.`
      );
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update password';
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSendEmailOtp = async () => {
    if (!isSuperAdmin || isSending) return;
    if (emailResendRemaining > 0) {
      toast.error(`Please wait ${emailResendRemaining} seconds.`);
      return;
    }
    if (!canSendEmailOtp) {
      toast.error('Please enter valid emails.');
      return;
    }
    setIsSending(true);
    try {
      const data = await sendSuperAdminEmailOtp({
        currentEmail: currentEmail.trim(),
        newEmail: newEmail.trim(),
      });
      setEmailOtpSent(true);
      setEmailOtpExpiresAt(data.expiresAt);
      setEmailResendAt(data.nextResendAllowedAt);
      toast.success('Verification codes sent.');
    } catch (error) {
      const err = error as Error & {
        data?: { error?: string; next_resend_allowed_at?: string; nextResendAllowedAt?: string };
      };
      if (err.data?.error === 'cooldown') {
        const nextAt = err.data.next_resend_allowed_at ?? err.data.nextResendAllowedAt;
        if (nextAt) {
          const remaining = getRemainingSeconds(nextAt);
          setEmailResendAt(nextAt);
          toast.error(`Please wait ${remaining} seconds.`);
          return;
        }
      }
      const message = error instanceof Error ? error.message : 'Failed to send codes';
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  };

  const handleUpdateEmail = async () => {
    if (!isSuperAdmin || isUpdating) return;
    if (!canUpdateEmail) {
      toast.error('Please complete all fields with valid values.');
      return;
    }
    setIsUpdating(true);
    try {
      await updateSuperAdminEmail({
        currentEmail: currentEmail.trim(),
        newEmail: newEmail.trim(),
        currentEmailOtp: currentEmailOtp.trim(),
        newEmailOtp: newEmailOtp.trim(),
      });
      toast.success('Your email has been updated.');
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update email';
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleWithdrawalUpdate = async () => {
    if (!isWithdrawalAdmin || isUpdating) return;
    if (!canUpdateWithdrawal) {
      toast.error('Please complete all fields with valid values.');
      return;
    }
    setIsUpdating(true);
    try {
      await updateWithdrawalAdminPassword({
        credentialType: withdrawalMode,
        currentActionPassword,
        newPassword,
        confirmPassword,
      });
      toast.success(
        `Your ${withdrawalMode === 'action' ? 'action' : 'login'} password has been updated.`
      );
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update password';
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === 'Tab') {
      const focusables = getFocusableElements(modalRef.current);
      if (focusables.length === 0) return;
      const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault();
          focusables[focusables.length - 1]?.focus();
        }
      } else if (currentIndex === focusables.length - 1) {
        event.preventDefault();
        focusables[0]?.focus();
      }
    }
    if (event.key === 'Enter') {
      const target = event.target as HTMLElement;
      const isField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (!isField) return;
      event.preventDefault();
      if (isSuperAdmin) {
        if (superMode === 'email') {
          if (emailOtpSent) {
            handleUpdateEmail();
          } else {
            handleSendEmailOtp();
          }
        } else if (passwordOtpSent) {
          handleUpdatePassword();
        } else {
          handleSendPasswordOtp();
        }
      } else if (isWithdrawalAdmin) {
        handleWithdrawalUpdate();
      }
    }
  };

  const handleRadioKey = (
    event: KeyboardEvent<HTMLDivElement>,
    options: string[],
    current: string,
    onChange: (value: string) => void
  ) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = options.indexOf(current);
    const nextIndex =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (currentIndex + 1) % options.length
        : (currentIndex - 1 + options.length) % options.length;
    onChange(options[nextIndex]);
    const focusables = getFocusableElements(modalRef.current);
    const next = focusables.find(
      (el) => el instanceof HTMLInputElement && el.value === options[nextIndex]
    );
    next?.focus();
  };

  if (!role) return null;

  return (
    <>
      <button type="button" className={buttonClassName} onClick={() => setIsOpen(true)}>
        Edit Credential
      </button>
      {isOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
          <div
            className="modal-card edit-credentials-modal"
            ref={modalRef}
            onKeyDown={handleKeyDown}
            onClick={(event) => event.stopPropagation()}
          >
            {isSuperAdmin && (
              <>
                <h2>Manage Account Credentials (Super Admin)</h2>
                <p>Choose what you want to edit:</p>
                <div
                  role="radiogroup"
                  aria-label="Choose credential to edit"
                  className="segmented-control"
                  onKeyDown={(event) =>
                    handleRadioKey(event, ['login', 'action', 'email'], superMode, (value) =>
                      setSuperMode(value as 'login' | 'action' | 'email')
                    )
                  }
                >
                  <label className="segmented-control-item">
                    <input
                      ref={firstRadioRef}
                      type="radio"
                      name="super-credential"
                      value="login"
                      checked={superMode === 'login'}
                      onChange={() => setSuperMode('login')}
                      className="segmented-control-input"
                    />
                    <span className="segmented-control-label">Login Password</span>
                  </label>
                  <label className="segmented-control-item">
                    <input
                      type="radio"
                      name="super-credential"
                      value="action"
                      checked={superMode === 'action'}
                      onChange={() => setSuperMode('action')}
                      className="segmented-control-input"
                    />
                    <span className="segmented-control-label">Action Password</span>
                  </label>
                  <label className="segmented-control-item">
                    <input
                      type="radio"
                      name="super-credential"
                      value="email"
                      checked={superMode === 'email'}
                      onChange={() => setSuperMode('email')}
                      className="segmented-control-input"
                    />
                    <span className="segmented-control-label">Email Address</span>
                  </label>
                </div>

                {superMode === 'email' ? (
                  <div className="form-grid">
                    <div className="form-row">
                      <label htmlFor="current-email">Please enter your current email address</label>
                      <input
                        id="current-email"
                        type="email"
                        value={currentEmail}
                        onChange={(event) => setCurrentEmail(event.target.value)}
                        aria-describedby={currentEmailDescribedBy}
                      />
                      <span id="current-email-hint" className="field-hint">
                        Must match the email currently on your account.
                      </span>
                      {!currentEmailValid && currentEmail && (
                        <span id="current-email-error" role="alert" className="field-error">
                          Enter a valid current email.
                        </span>
                      )}
                    </div>
                    <div className="form-row">
                      <label htmlFor="new-email">Please enter your new email address</label>
                      <input
                        id="new-email"
                        type="email"
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                        aria-describedby={!newEmailValid && newEmail ? 'new-email-error' : undefined}
                      />
                      {!newEmailValid && newEmail && (
                        <span id="new-email-error" role="alert" className="field-error">
                          Enter a valid new email.
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleSendEmailOtp}
                      disabled={!canSendEmailOtp || isSending || isUpdating}
                    >
                      <span className="button-content">
                        {isSending ? <span className="spinner" /> : null}
                        {emailResendRemaining > 0
                          ? `Wait ${emailResendRemaining}s`
                          : 'Verify and Send Codes'}
                      </span>
                    </button>

                    {emailOtpSent && (
                      <>
                        <p className="otp-message">
                          A verification code was sent to your Current Email Address, and another to your New Email
                          Address. Please enter the codes below.
                        </p>
                        {emailCountdown && (
                          <p className="otp-countdown">Expires in {emailCountdown}</p>
                        )}
                        <div className="form-row">
                          <label htmlFor="current-email-otp">Code sent to current email</label>
                          <input
                            id="current-email-otp"
                            inputMode="numeric"
                            maxLength={6}
                            value={currentEmailOtp}
                            onChange={(event) =>
                              setCurrentEmailOtp(event.target.value.replace(/[^\d]/g, ''))
                            }
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="new-email-otp">Code sent to new email</label>
                          <input
                            id="new-email-otp"
                            inputMode="numeric"
                            maxLength={6}
                            value={newEmailOtp}
                            onChange={(event) =>
                              setNewEmailOtp(event.target.value.replace(/[^\d]/g, ''))
                            }
                          />
                        </div>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={handleUpdateEmail}
                          disabled={!canUpdateEmail || isSending || isUpdating}
                        >
                          <span className="button-content">
                            {isUpdating ? <span className="spinner" /> : null}
                            Update Email
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="form-grid">
                    <div className="form-row">
                      <label htmlFor="registered-email">Your registered email</label>
                      <input
                        id="registered-email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        aria-describedby={!emailValid && email ? 'registered-email-error' : undefined}
                      />
                      {!emailValid && email && (
                        <span id="registered-email-error" role="alert" className="field-error">
                          Enter a valid registered email.
                        </span>
                      )}
                    </div>
                    <div className="form-row">
                      <label htmlFor="new-password">New password</label>
                      <div className="password-input-row">
                        <input
                          id="new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          aria-describedby={passwordErrors.length ? 'password-errors' : undefined}
                        />
                        <button
                          type="button"
                          className="password-toggle-button"
                          onMouseDown={() => setShowNewPassword(true)}
                          onMouseUp={() => setShowNewPassword(false)}
                          onMouseLeave={() => setShowNewPassword(false)}
                          onTouchStart={() => setShowNewPassword(true)}
                          onTouchEnd={() => setShowNewPassword(false)}
                          aria-label="Hold to view password"
                        >
                          <EyeIcon />
                        </button>
                      </div>
                      {passwordErrors.length > 0 && (
                        <div id="password-errors" role="alert" className="field-error">
                          {passwordErrors.map((error) => (
                            <div key={error}>{error}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="form-row">
                      <label htmlFor="confirm-password">Confirm new password</label>
                      <div className="password-input-row">
                        <input
                          id="confirm-password"
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          aria-describedby={confirmError ? 'confirm-password-error' : undefined}
                        />
                        <button
                          type="button"
                          className="password-toggle-button"
                          onMouseDown={() => setShowConfirmPassword(true)}
                          onMouseUp={() => setShowConfirmPassword(false)}
                          onMouseLeave={() => setShowConfirmPassword(false)}
                          onTouchStart={() => setShowConfirmPassword(true)}
                          onTouchEnd={() => setShowConfirmPassword(false)}
                          aria-label="Hold to view password"
                        >
                          <EyeIcon />
                        </button>
                      </div>
                      {confirmError && (
                        <span id="confirm-password-error" role="alert" className="field-error">
                          {confirmError}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleSendPasswordOtp}
                      disabled={!canSendPasswordOtp || isSending || isUpdating}
                    >
                      <span className="button-content">
                        {isSending ? <span className="spinner" /> : null}
                        {passwordResendRemaining > 0
                          ? `Wait ${passwordResendRemaining}s`
                          : 'Send Verification Code'}
                      </span>
                    </button>

                    {passwordOtpSent && (
                      <>
                        <p className="otp-message">
                          A verification code was sent to Your Email Address. Please enter the code.
                        </p>
                        {passwordCountdown && (
                          <p className="otp-countdown">Expires in {passwordCountdown}</p>
                        )}
                        <div className="form-row">
                          <label htmlFor="password-otp">Verification code</label>
                          <input
                            id="password-otp"
                            inputMode="numeric"
                            maxLength={6}
                            value={otp}
                            placeholder="Enter 6-digit code"
                            onChange={(event) => setOtp(event.target.value.replace(/[^\d]/g, ''))}
                          />
                        </div>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={handleUpdatePassword}
                          disabled={!canUpdatePassword || isSending || isUpdating}
                        >
                          <span className="button-content">
                            {isUpdating ? <span className="spinner" /> : null}
                            Update Password
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {isWithdrawalAdmin && (
              <>
                <h2>Change Your Password (Withdrawal Admin)</h2>
                <p>Choose what you want to edit:</p>
                <div
                  role="radiogroup"
                  aria-label="Choose credential to edit"
                  className="segmented-control"
                  onKeyDown={(event) =>
                    handleRadioKey(event, ['login', 'action'], withdrawalMode, (value) =>
                      setWithdrawalMode(value as 'login' | 'action')
                    )
                  }
                >
                  <label className="segmented-control-item">
                    <input
                      ref={firstRadioRef}
                      type="radio"
                      name="withdrawal-credential"
                      value="login"
                      checked={withdrawalMode === 'login'}
                      onChange={() => setWithdrawalMode('login')}
                      className="segmented-control-input"
                    />
                    <span className="segmented-control-label">Login Password</span>
                  </label>
                  <label className="segmented-control-item">
                    <input
                      type="radio"
                      name="withdrawal-credential"
                      value="action"
                      checked={withdrawalMode === 'action'}
                      onChange={() => setWithdrawalMode('action')}
                      className="segmented-control-input"
                    />
                    <span className="segmented-control-label">Action Password</span>
                  </label>
                </div>

                <div className="form-grid">
                  <div className="form-row">
                    <label htmlFor="current-action-password">Current Action Password</label>
                    <div className="password-input-row">
                      <input
                        id="current-action-password"
                        type={showCurrentActionPassword ? 'text' : 'password'}
                        value={currentActionPassword}
                        onChange={(event) => setCurrentActionPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        className="password-toggle-button"
                        onMouseDown={() => setShowCurrentActionPassword(true)}
                        onMouseUp={() => setShowCurrentActionPassword(false)}
                        onMouseLeave={() => setShowCurrentActionPassword(false)}
                        onTouchStart={() => setShowCurrentActionPassword(true)}
                        onTouchEnd={() => setShowCurrentActionPassword(false)}
                        aria-label="Hold to view password"
                      >
                        <EyeIcon />
                      </button>
                    </div>
                  </div>
                  <div className="form-row">
                    <label htmlFor="new-password-withdrawal">New password</label>
                    <div className="password-input-row">
                      <input
                        id="new-password-withdrawal"
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        aria-describedby={passwordErrors.length ? 'withdrawal-password-errors' : undefined}
                      />
                      <button
                        type="button"
                        className="password-toggle-button"
                        onMouseDown={() => setShowNewPassword(true)}
                        onMouseUp={() => setShowNewPassword(false)}
                        onMouseLeave={() => setShowNewPassword(false)}
                        onTouchStart={() => setShowNewPassword(true)}
                        onTouchEnd={() => setShowNewPassword(false)}
                        aria-label="Hold to view password"
                      >
                        <EyeIcon />
                      </button>
                    </div>
                    {passwordErrors.length > 0 && (
                      <div id="withdrawal-password-errors" role="alert" className="field-error">
                        {passwordErrors.map((error) => (
                          <div key={error}>{error}</div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="form-row">
                    <label htmlFor="confirm-password-withdrawal">Confirm new password</label>
                    <div className="password-input-row">
                      <input
                        id="confirm-password-withdrawal"
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        aria-describedby={confirmError ? 'withdrawal-confirm-error' : undefined}
                      />
                      <button
                        type="button"
                        className="password-toggle-button"
                        onMouseDown={() => setShowConfirmPassword(true)}
                        onMouseUp={() => setShowConfirmPassword(false)}
                        onMouseLeave={() => setShowConfirmPassword(false)}
                        onTouchStart={() => setShowConfirmPassword(true)}
                        onTouchEnd={() => setShowConfirmPassword(false)}
                        aria-label="Hold to view password"
                      >
                        <EyeIcon />
                      </button>
                    </div>
                    {confirmError && (
                      <span id="withdrawal-confirm-error" role="alert" className="field-error">
                        {confirmError}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleWithdrawalUpdate}
                    disabled={!canUpdateWithdrawal || isSending || isUpdating}
                  >
                    <span className="button-content">
                      {isUpdating ? <span className="spinner" /> : null}
                      Change Password
                    </span>
                  </button>
                </div>
              </>
            )}

            <button type="button" className="secondary-button" onClick={closeModal}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default EditCredential;
