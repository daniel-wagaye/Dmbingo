import dotenv from 'dotenv';

dotenv.config();

const getEnv = (key: string, fallback = '') => process.env[key] ?? fallback;

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
  gameServerUrl: getEnv('GAME_SERVER_URL'),
  gameServerSecret: getEnv('GAME_SERVER_SECRET'),
  regexWakeupUrl: getEnv('REGEX_WAKEUP_URL', 'https://deposit-acceptor.onrender.com/internal/regex-wakeup'),
  accessTokenTtl: '15m' as const,
  refreshTokenTtl: '1d' as const,
  otpResendCooldownSeconds: 60,
  otpMaxAttempts: 5,
  otpResendLimitWindowHours: 3,
  otpResendLimitMax: 5,
};
