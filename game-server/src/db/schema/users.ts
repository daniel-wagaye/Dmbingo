import { pgTable, bigint, varchar, text, numeric, integer, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  telegram_id: bigint('telegram_id', { mode: 'number' }).primaryKey(),
  phone_number: varchar('phone_number', { length: 25 }).unique(),
  username: text('username'),
  first_name: text('first_name'),
  withdrawal_wallet: numeric('withdrawal_wallet', { precision: 12, scale: 2 }).default('0'),
  non_withdrawal_wallet: numeric('non_withdrawal_wallet', { precision: 12, scale: 2 }).default('0'),
  referral_count: integer('referral_count').default(0),
  last_referred_date: timestamp('last_referred_date', { withTimezone: true }),
  language: text('language').default('am'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});