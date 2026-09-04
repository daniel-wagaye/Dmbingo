import { pgTable, bigserial, text, smallint, jsonb, boolean, timestamp, integer, numeric } from 'drizzle-orm/pg-core';

export const games = pgTable('games', {
  game_id: bigserial('game_id', { mode: 'number' }).primaryKey(),
  phase: text('phase').default('picking'),
  active_players: smallint('active_players').default(0),
  real_p: smallint('real_p'),
  shuffled_nums: jsonb('shuffled_nums'),
  calling_started: boolean('calling_started').default(false),
  picking_ends_at: timestamp('picking_ends_at', { withTimezone: true }),
  winner_reveal_ends_at: timestamp('winner_reveal_ends_at', { withTimezone: true }),
  called_index: integer('called_index').notNull().default(0),
  minimum_player: smallint('minimum_player').notNull(),
  stake_amount: numeric('stake_amount', { precision: 12, scale: 2 }).notNull(),
  prize_amount: numeric('prize_amount', { precision: 12, scale: 2 }),
  house_profit: numeric('house_profit', { precision: 12, scale: 2 }),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finished_at: timestamp('finished_at', { withTimezone: true }),
});

export const gameConfig = pgTable('game_config', {
  id: smallint('id').primaryKey(),
  stake_amount: numeric('stake_amount', { precision: 12, scale: 2 }).notNull().default('10'),
  picking_countdown_end_time: integer('picking_countdown_end_time').notNull().default(30),
  minimum_player: smallint('minimum_player').notNull().default(2),
  prize_percent: integer('prize_percent').default(80),
  referral_amount: numeric('referral_amount', { precision: 12, scale: 2 }).notNull().default('10'),
  referral_monthly_limit: integer('referral_monthly_limit').notNull().default(10),
  registration_bonus: numeric('registration_bonus', { precision: 12, scale: 2 }).notNull().default('10'),
  bot_status: text('bot_status').default('on'),
  min_bot_amount: integer('min_bot_amount').default(10),
  max_bot_amount: integer('max_bot_amount').default(30),
  streak_bonus_5_days: numeric('streak_bonus_5_days', { precision: 12, scale: 2 }).notNull().default('20'),
  streak_bonus_10_days: numeric('streak_bonus_10_days', { precision: 12, scale: 2 }).notNull().default('60'),
  streak_bonus_30_days: numeric('streak_bonus_30_days', { precision: 12, scale: 2 }).notNull().default('200'),
  last_updated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
});

export const gameStatus = pgTable('game_status', {
  id: smallint('id').primaryKey(),
  status: text('status').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});