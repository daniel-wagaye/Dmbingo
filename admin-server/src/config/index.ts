import dotenv from 'dotenv';

dotenv.config();

const getEnv = (key: string, fallback = '') => process.env[key] ?? fallback;
const getNumber = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number environment variable: ${key}`);
  }
  return parsed;
};
const getBoolean = (key: string, fallback: boolean): boolean => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value.toLowerCase() === 'true';
};

export const config = {
  port: Number.parseInt(getEnv('PORT', '4000'), 10),
  databaseUrl: getEnv('DATABASE_URL'),
  jwtSecret: getEnv('JWT_SECRET_ADMIN'),
  jwtRefreshSecret: getEnv('JWT_REFRESH_SECRET_ADMIN', getEnv('JWT_SECRET_ADMIN')),
  otpSecret: getEnv('OTP_SERVER_SECRET', getEnv('JWT_SECRET_ADMIN')),
  adminClientOrigin: getEnv('ADMIN_CLIENT_ORIGIN', 'http://localhost:5174').replace(
    /\/$/,
    ''
  ),
  resendApiKey: getEnv('RESEND_API_KEY'),
  resendFrom: getEnv('RESEND_FROM', 'noreply@dmbingo.app'),
  telegramBotToken: getEnv('TELEGRAM_BOT_TOKEN'),
  supportBotToken: getEnv('SUPPORT_BOT_TOKEN'),
  webhookPassKey: getEnv('WEBHOOK_PASS_KEY'),
  webhookBodyLimit: getEnv('WEBHOOK_BODY_LIMIT', '100kb'),
  globalRateLimitWindowMs: getNumber('GLOBAL_RATE_LIMIT_WINDOW_MS', 60000),
  globalRateLimitMaxRequests: getNumber('GLOBAL_RATE_LIMIT_MAX_REQUESTS', 120),
  trustProxy: getBoolean('TRUST_PROXY', false),
  advisoryLockKey: getNumber('ADVISORY_LOCK_KEY', 20260320),
  batchSize: getNumber('BATCH_SIZE', 5),
  sendGapMs: getNumber('SEND_GAP_MS', 3000),
  maxAttempts: getNumber('MAX_ATTEMPTS', 5),
  maxBatchIterationsPerWake: getNumber('MAX_BATCH_ITERATIONS_PER_WAKE', 20),
  processingStaleMinutes: getNumber('PROCESSING_STALE_MINUTES', 10),
  recoveryJobIntervalMs: getNumber('RECOVERY_JOB_INTERVAL_MS', 60000),
  telegramApiMaxRetries: getNumber('TELEGRAM_API_MAX_RETRIES', 5),
  telegramRetryBaseDelayMs: getNumber('TELEGRAM_RETRY_BASE_DELAY_MS', 500),
  dbMaxConnections: getNumber('DB_MAX_CONNECTIONS', 4),
  dbIdleTimeoutMs: getNumber('DB_IDLE_TIMEOUT_MS', 10000),
  dbConnectionTimeoutMs: getNumber('DB_CONNECTION_TIMEOUT_MS', 5000),
  dbQueryMaxRetries: getNumber('DB_QUERY_MAX_RETRIES', 5),
  dbRetryBaseDelayMs: getNumber('DB_RETRY_BASE_DELAY_MS', 150),
  adminViewBaseUrl: getEnv(
    'ADMIN_VIEW_BASE_URL',
    'https://admin.dmbingo.app/withdrawals'
  ),
  monitoringBearerToken: getEnv('MONITORING_BEARER_TOKEN', ''),
  lookupWindowMs: getNumber('LOOKUP_WINDOW_MS', 60000),
  lookupMaxRequests: getNumber('LOOKUP_MAX_REQUESTS', 30),
  lookupHistoryLimit: getNumber('LOOKUP_HISTORY_LIMIT', 10),
  gameServerUrl: getEnv('GAME_SERVER_URL'),
  gameServerSecret: getEnv('GAME_SERVER_SECRET'),
  regexWakeupUrl: getEnv('REGEX_WAKEUP_URL', 'https://deposit-acceptor.onrender.com/internal/regex-wakeup'),
  startCommandPhotoId: getEnv('START_COMMAND_PHOTO_ID'),
  accessTokenTtl: '2h' as const,
  refreshTokenTtl: '2h' as const,
  otpResendCooldownSeconds: 60,
  otpMaxAttempts: 5,
  otpResendLimitWindowHours: 3,
  otpResendLimitMax: 5,
};
