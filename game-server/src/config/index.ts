import dotenv from 'dotenv';
dotenv.config();

const REQUIRED_ENV = ['DATABASE_URL', 'BOT_TOKEN', 'GAME_SECRET'] as const;
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`[config] FATAL: Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL!,
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
  botToken: process.env.BOT_TOKEN!.trim(),
  gameSecret: process.env.GAME_SECRET!.trim(),
  registerStickerId: process.env.REGISTER_STICKER_ID?.trim() || '',
  referralStickerId: process.env.REFERRAL_STICKER_ID?.trim() || '',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5175',

  // Rate limits (configurable via .env)
  pickRateLimitWindowMs: parseInt(process.env.PICK_RATE_LIMIT_WINDOW_MS || '60000', 10),
  pickRateLimitMax: parseInt(process.env.PICK_RATE_LIMIT_MAX || '5', 10),
  claimRateLimitWindowMs: parseInt(process.env.CLAIM_RATE_LIMIT_WINDOW_MS || '60000', 10),
  claimRateLimitMax: parseInt(process.env.CLAIM_RATE_LIMIT_MAX || '5', 10),
  gameControlRateLimitWindowMs: parseInt(process.env.GAME_CONTROL_RATE_LIMIT_WINDOW_MS || '60000', 10),
  gameControlRateLimitMax: parseInt(process.env.GAME_CONTROL_RATE_LIMIT_MAX || '10', 10),
  languageRateLimitWindowMs: parseInt(process.env.LANGUAGE_RATE_LIMIT_WINDOW_MS || '60000', 10),
  languageRateLimitMax: parseInt(process.env.LANGUAGE_RATE_LIMIT_MAX || '5', 10),
  nameRateLimitWindowMs: parseInt(process.env.NAME_RATE_LIMIT_WINDOW_MS || '600000', 10),
  nameRateLimitMax: parseInt(process.env.NAME_RATE_LIMIT_MAX || '5', 10),
  historyRateLimitWindowMs: parseInt(process.env.HISTORY_RATE_LIMIT_WINDOW_MS || '60000', 10),
  historyRateLimitMax: parseInt(process.env.HISTORY_RATE_LIMIT_MAX || '10', 10),
  couponRateLimitWindowMs: parseInt(process.env.COUPON_RATE_LIMIT_WINDOW_MS || '60000', 10),
  couponRateLimitMax: parseInt(process.env.COUPON_RATE_LIMIT_MAX || '3', 10),
  depositRateLimitWindowMs: parseInt(process.env.DEPOSIT_RATE_LIMIT_WINDOW_MS || '60000', 10),
  depositRateLimitMax: parseInt(process.env.DEPOSIT_RATE_LIMIT_MAX || '3', 10),
  transferRateLimitWindowMs: parseInt(process.env.TRANSFER_RATE_LIMIT_WINDOW_MS || '60000', 10),
  transferRateLimitMax: parseInt(process.env.TRANSFER_RATE_LIMIT_MAX || '5', 10),
  transferCommissionPercent: parseFloat(process.env.TRANSFER_COMMISSION_PERCENT || '2'),
  withdrawRateLimitWindowMs: parseInt(process.env.WITHDRAW_RATE_LIMIT_WINDOW_MS || '60000', 10),
  withdrawRateLimitMax: parseInt(process.env.WITHDRAW_RATE_LIMIT_MAX || '3', 10),
  withdrawMaxPending: parseInt(process.env.WITHDRAW_MAX_PENDING || '5', 10),
  withdrawWebhookUrl: process.env.WITHDRAW_WEBHOOK_URL || '',
  withdrawWebhookPassKey: process.env.WITHDRAW_WEBHOOK_PASS_KEY || '',
  callingIntervalMs: parseInt(process.env.CALLING_INTERVAL_MS || '2000', 10),
  callingStartDelayMs: parseInt(process.env.CALLING_START_DELAY_MS || '3000', 10),
  winnerAcceptanceWindowMs: parseInt(process.env.WINNER_ACCEPTANCE_WINDOW_MS || '1000', 10),
  winnerRevealDurationMs: parseInt(process.env.WINNER_REVEAL_DURATION_MS || '10000', 10),
  maxRecoveryRetries: parseInt(process.env.MAX_RECOVERY_RETRIES || '5', 10),
  dbMaxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '23', 10),
  dbIdleTimeoutSeconds: parseInt(process.env.DB_IDLE_TIMEOUT_SECONDS || '30', 10),
  dbConnectTimeoutSeconds: parseInt(process.env.DB_CONNECT_TIMEOUT_SECONDS || '30', 10),
  dbMaxLifetimeSeconds: parseInt(process.env.DB_MAX_LIFETIME_SECONDS || '3600', 10),
  dbQueryMaxRetries: parseInt(process.env.DB_QUERY_MAX_RETRIES || '4', 10),
  dbRetryBaseDelayMs: parseInt(process.env.DB_RETRY_BASE_DELAY_MS || '250', 10),
  rateLimitCleanupTimeUtc: process.env.RATE_LIMIT_CLEANUP_TIME_UTC || '00:00',
  startCommandPhotoId: process.env.START_COMMAND_PHOTO_ID?.trim() || '',
};
