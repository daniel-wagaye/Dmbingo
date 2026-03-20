import { pgTable, bigserial, bigint, boolean, numeric, timestamp } from 'drizzle-orm/pg-core';

export const referralsHistory = pgTable('referrals_history', {
  referral_id: bigserial('referral_id', { mode: 'number' }).primaryKey(),
  referrer_id: bigint('referrer_id', { mode: 'number' }),
  referred_user_id: bigint('referred_user_id', { mode: 'number' }),
  rewarded: boolean('rewarded').default(false),
  rewarded_amount: numeric('rewarded_amount', { precision: 12, scale: 2 }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});