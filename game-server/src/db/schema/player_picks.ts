import { pgTable, smallint, jsonb, bigint, numeric, boolean, text, timestamp } from 'drizzle-orm/pg-core';

export const playerPicks = pgTable('player_picks', {
  board_id: smallint('board_id').primaryKey(),
  bingo_card: jsonb('bingo_card').notNull(),
  telegram_id: bigint('telegram_id', { mode: 'number' }),
  game_id: bigint('game_id', { mode: 'number' }),
  withdrawal_used: numeric('withdrawal_used', { precision: 12, scale: 2 }).notNull(),
  non_withdrawal_used: numeric('non_withdrawal_used', { precision: 12, scale: 2 }).notNull(),
  winner: boolean('winner').default(false),
  invalid: boolean('invalid').default(false),
  winner_name: text('winner_name'),
  picked_at: timestamp('picked_at', { withTimezone: true }).defaultNow(),
});