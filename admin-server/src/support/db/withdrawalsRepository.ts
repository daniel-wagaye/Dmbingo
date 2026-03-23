import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../../config';
import type { WithdrawalRow } from '../types';

const mapWithdrawal = (row: QueryResultRow): WithdrawalRow => ({
  withdrawal_id: Number(row.withdrawal_id),
  telegram_id: row.telegram_id === null ? null : Number(row.telegram_id),
  bank: row.bank,
  account_holder_name: row.account_holder_name,
  account_num: row.account_num,
  amount: String(row.amount),
  status: row.status,
  declined_reason: row.declined_reason,
  admin_tx_number: row.admin_tx_number,
  admin_first_name: row.admin_first_name,
  text_status: row.text_status,
  tg_message_id: row.tg_message_id === null ? null : Number(row.tg_message_id),
  attempts: Number(row.attempts),
  created_at: new Date(row.created_at),
  processed_at: row.processed_at ? new Date(row.processed_at) : null,
  last_error: row.last_error ?? null,
});

export class WithdrawalsRepository {
  constructor(private readonly pool: Pool) {}

  async tryAcquireLock(client: PoolClient): Promise<boolean> {
    const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
      config.advisoryLockKey,
    ]);
    return result.rows[0]?.locked === true;
  }

  async releaseLock(client: PoolClient): Promise<void> {
    await client.query('SELECT pg_advisory_unlock($1)', [config.advisoryLockKey]);
  }

  async claimPendingBatch(client: PoolClient, size: number): Promise<WithdrawalRow[]> {
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `
          WITH c AS (
            SELECT withdrawal_id
            FROM withdrawals_request
            WHERE text_status = 'pending'
            ORDER BY withdrawal_id ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          ),
          u AS (
            UPDATE withdrawals_request wr
            SET text_status = 'processing', processed_at = NOW()
            FROM c
            WHERE wr.withdrawal_id = c.withdrawal_id
            RETURNING wr.withdrawal_id
          )
          SELECT wr.*
          FROM withdrawals_request wr
          INNER JOIN u ON u.withdrawal_id = wr.withdrawal_id
          ORDER BY wr.withdrawal_id ASC;
        `,
        [size]
      );
      await client.query('COMMIT');
      return result.rows.map(mapWithdrawal);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  async claimUpdatedBatch(client: PoolClient, size: number): Promise<WithdrawalRow[]> {
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `
          WITH c AS (
            SELECT withdrawal_id
            FROM withdrawals_request
            WHERE status IN ('approved', 'declined')
              AND text_status = 'sent'
            ORDER BY withdrawal_id ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          )
          SELECT wr.*
          FROM withdrawals_request wr
          INNER JOIN c ON wr.withdrawal_id = c.withdrawal_id
          ORDER BY wr.withdrawal_id ASC;
        `,
        [size]
      );
      await client.query('COMMIT');
      return result.rows.map(mapWithdrawal);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  async markSent(withdrawalId: number, tgMessageId: number): Promise<void> {
    await this.pool.query(
      `
        UPDATE withdrawals_request
        SET tg_message_id = $1,
            text_status = 'sent',
            attempts = 0
        WHERE withdrawal_id = $2
      `,
      [tgMessageId, withdrawalId]
    );
  }

  async markFinished(withdrawalId: number, tgMessageId: number | null): Promise<void> {
    await this.pool.query(
      `
        UPDATE withdrawals_request
        SET tg_message_id = COALESCE($1, tg_message_id),
            text_status = 'finished',
            attempts = 0,
            processed_at = NOW()
        WHERE withdrawal_id = $2
      `,
      [tgMessageId, withdrawalId]
    );
  }

  async markTransientFailure(withdrawalId: number): Promise<void> {
    await this.pool.query(
      `
        UPDATE withdrawals_request
        SET attempts = attempts + 1,
            text_status = 'pending',
            processed_at = NOW()
        WHERE withdrawal_id = $1
      `,
      [withdrawalId]
    );
  }

  async markUpdateFailure(withdrawalId: number): Promise<void> {
    await this.pool.query(
      `
        UPDATE withdrawals_request
        SET attempts = attempts + 1,
            text_status = 'sent',
            processed_at = NOW()
        WHERE withdrawal_id = $1
      `,
      [withdrawalId]
    );
  }

  async getFailedRows(limit: number): Promise<WithdrawalRow[]> {
    const result = await this.pool.query(
      `
        SELECT *
        FROM withdrawals_request
        WHERE attempts >= $1
        ORDER BY withdrawal_id ASC
        LIMIT $2
      `,
      [config.maxAttempts, limit]
    );
    return result.rows.map(mapWithdrawal);
  }

  async resetStaleProcessingRows(): Promise<number> {
    const result = await this.pool.query(
      `
        UPDATE withdrawals_request
        SET text_status = 'pending'
        WHERE text_status = 'processing'
          AND processed_at < NOW() - ($1::int * INTERVAL '1 minute')
      `,
      [config.processingStaleMinutes]
    );
    return result.rowCount ?? 0;
  }

  async getActiveWithdrawRecipient(): Promise<number | null> {
    const result = await this.pool.query<{ telegram_id: string }>(
      `
        SELECT telegram_id
        FROM withdraw_message_admin
        WHERE is_active = TRUE
        ORDER BY telegram_id ASC
        LIMIT 1
      `
    );
    if (!result.rowCount || result.rowCount === 0) {
      return null;
    }
    return Number(result.rows[0].telegram_id);
  }
}
