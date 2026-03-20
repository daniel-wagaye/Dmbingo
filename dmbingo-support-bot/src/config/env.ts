import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.example', override: false });

const readEnv = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value !== undefined && value !== '') {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required environment variable: ${key}`);
};

const readNumber = (key: string, fallback: number): number => {
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

const readBoolean = (key: string, fallback: boolean): boolean => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value.toLowerCase() === 'true';
};

export const config = {
  nodeEnv: readEnv('NODE_ENV', 'development'),
  port: readNumber('PORT', 3001),
  databaseUrl: readEnv('DATABASE_URL'),
  dbPoolMax: readNumber('DB_POOL_MAX', 2),
  supabaseCaCertPath: readEnv('SUPABASE_CA_CERT_PATH', './certs/prod-ca-2021.crt'),
  dbPoolIdleTimeoutMs: readNumber('DB_POOL_IDLE_TIMEOUT_MS', 20_000),
  dbPoolConnectionTimeoutMs: readNumber('DB_POOL_CONNECTION_TIMEOUT_MS', 30_000),
  dbStatementTimeoutMs: readNumber('DB_STATEMENT_TIMEOUT_MS', 15_000),
  dbQueryTimeoutMs: readNumber('DB_QUERY_TIMEOUT_MS', 15_000),
  dbIdleInTransactionTimeoutMs: readNumber('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 15_000),
  telegramBotToken: readEnv('TELEGRAM_BOT_TOKEN'),
  webhookPassKey: readEnv('WEBHOOK_PASS_KEY'),
  webhookBodyLimit: readEnv('WEBHOOK_BODY_LIMIT', '100kb'),
  globalRateLimitWindowMs: readNumber('GLOBAL_RATE_LIMIT_WINDOW_MS', 60_000),
  globalRateLimitMaxRequests: readNumber('GLOBAL_RATE_LIMIT_MAX_REQUESTS', 120),
  trustProxy: readBoolean('TRUST_PROXY', false),
  advisoryLockKey: readNumber('ADVISORY_LOCK_KEY', 20260320),
  batchSize: readNumber('BATCH_SIZE', 5),
  sendGapMs: readNumber('SEND_GAP_MS', 3000),
  maxAttempts: readNumber('MAX_ATTEMPTS', 5),
  maxBatchIterationsPerWake: readNumber('MAX_BATCH_ITERATIONS_PER_WAKE', 20),
  processingStaleMinutes: readNumber('PROCESSING_STALE_MINUTES', 10),
  recoveryJobIntervalMs: readNumber('RECOVERY_JOB_INTERVAL_MS', 60_000),
  telegramApiMaxRetries: readNumber('TELEGRAM_API_MAX_RETRIES', 5),
  telegramRetryBaseDelayMs: readNumber('TELEGRAM_RETRY_BASE_DELAY_MS', 500),
  adminViewBaseUrl: readEnv(
    'ADMIN_VIEW_BASE_URL',
    'https://admin.dmbingo.app/withdrawals/{withdrawal_id}',
  ),
  monitoringBearerToken: readEnv('MONITORING_BEARER_TOKEN', ''),
  lookupWindowMs: readNumber('LOOKUP_WINDOW_MS', 60_000),
  lookupMaxRequests: readNumber('LOOKUP_MAX_REQUESTS', 30),
  lookupHistoryLimit: readNumber('LOOKUP_HISTORY_LIMIT', 10),
};
