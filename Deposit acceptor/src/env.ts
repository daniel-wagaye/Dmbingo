import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().url(),
  DEPOSIT_GATEWAY_PATH_TOKEN: z.string().min(1),
  DEPOSIT_GATEWAY_PASS_KEY: z.string().min(1),
  DEPOSIT_GATEWAY_HEADER_NAME: z.string().min(1).default('pass_key'),
  RATE_LIMIT_SMS: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WAKEUP: z.coerce.number().int().positive().default(2),
  MIN_RELOAD_INTERVAL_MS: z.coerce.number().int().nonnegative().default(2000),
  MIN_DEPOSIT_AMOUNT: z.coerce.number().positive().default(30),
  DEPOSIT_BONUS_PERCENT: z.coerce.number().nonnegative().default(10),
  DB_MAX_CONNECTIONS: z.coerce.number().int().positive().default(4),
  DB_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  DB_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
  DB_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(30000),
  DB_RETRY_FOREVER_ON_NETWORK: z.coerce.boolean().default(true),
  HTTP_REBIND_DELAY_MS: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(src?: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(src ?? process.env);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const msg = Object.entries(flat).map(([k, v]) => `${k}: ${(v ?? []).join(', ')}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  return parsed.data;
}
