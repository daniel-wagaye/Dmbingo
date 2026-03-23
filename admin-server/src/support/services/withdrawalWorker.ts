import { Pool } from 'pg';
import { config } from '../../config';
import { WithdrawalsRepository } from '../db/withdrawalsRepository';
import type { WithdrawalRow } from '../types';
import { sleep } from '../utils';
import { TelegramClient } from './telegramClient';
import { buildWithdrawalInlineKeyboard, buildWithdrawalMessage } from './withdrawalMessage';

const withinEditableWindow = (createdAt: Date): boolean =>
  createdAt.getTime() >= Date.now() - 47 * 60 * 60 * 1000;

export class WithdrawalWorker {
  private readonly repository: WithdrawalsRepository;
  private readonly telegramClient: TelegramClient;
  private createdWakePending = false;
  private updatedWakePending = false;
  private running = false;

  constructor(private readonly pool: Pool) {
    this.repository = new WithdrawalsRepository(pool);
    this.telegramClient = new TelegramClient();
  }

  wakeCreated(): void {
    this.createdWakePending = true;
    this.startRun();
  }

  wakeUpdated(): void {
    this.updatedWakePending = true;
    this.startRun();
  }

  async runRecovery(): Promise<number> {
    return this.repository.resetStaleProcessingRows();
  }

  async getFailedRows(limit = 100): Promise<WithdrawalRow[]> {
    return this.repository.getFailedRows(limit);
  }

  private startRun(): void {
    void this.run().catch((error) => {
      process.stderr.write(`Withdrawal worker run failed: ${String(error)}\n`);
    });
  }

  private async run(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      while (this.createdWakePending || this.updatedWakePending) {
        if (this.createdWakePending) {
          this.createdWakePending = false;
          await this.processCreatedWake();
        }
        if (this.updatedWakePending) {
          this.updatedWakePending = false;
          await this.processUpdatedWake();
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async processCreatedWake(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const locked = await this.repository.tryAcquireLock(client);
      if (!locked) {
        return;
      }

      const chatId = await this.repository.getActiveWithdrawRecipient();
      if (!chatId) {
        return;
      }

      for (let iteration = 0; iteration < config.maxBatchIterationsPerWake; iteration += 1) {
        const rows = await this.repository.claimPendingBatch(client, config.batchSize);
        if (rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const message = buildWithdrawalMessage(row);
          const markup = buildWithdrawalInlineKeyboard();
          try {
            const sent = await this.telegramClient.sendMessage(chatId, message, markup);
            await this.updateWithRetry(() => this.repository.markSent(row.withdrawal_id, sent.message_id), row);
          } catch (error) {
            process.stderr.write(
              `Support send failed for withdrawal ${row.withdrawal_id} to chat ${String(chatId)}: ${
                error instanceof Error ? error.message : String(error)
              }\n`
            );
            await this.safeFailureMark(
              () =>
                this.repository.markTransientFailure(row.withdrawal_id),
              row.withdrawal_id
            );
          }
          await sleep(config.sendGapMs);
        }
      }
    } finally {
      await this.repository.releaseLock(client).catch(() => undefined);
      client.release();
    }
  }

  private async processUpdatedWake(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const locked = await this.repository.tryAcquireLock(client);
      if (!locked) {
        return;
      }

      const chatId = await this.repository.getActiveWithdrawRecipient();
      if (!chatId) {
        return;
      }

      const rows = await this.repository.claimUpdatedBatch(client, config.batchSize);
      for (const row of rows) {
        try {
          const markup = buildWithdrawalInlineKeyboard();
          if (row.tg_message_id && withinEditableWindow(row.created_at)) {
            await this.telegramClient.editMessageText(
              chatId,
              row.tg_message_id,
              buildWithdrawalMessage(row),
              markup
            );
            await this.updateWithRetry(() => this.repository.markFinished(row.withdrawal_id, row.tg_message_id), row);
          } else {
            if (row.tg_message_id) {
              await this.telegramClient.deleteMessage(chatId, row.tg_message_id);
            }
            const sent = await this.telegramClient.sendMessage(chatId, buildWithdrawalMessage(row, true), markup);
            await this.updateWithRetry(() => this.repository.markFinished(row.withdrawal_id, sent.message_id), row);
          }
        } catch (error) {
          process.stderr.write(
            `Support update failed for withdrawal ${row.withdrawal_id} to chat ${String(chatId)}: ${
              error instanceof Error ? error.message : String(error)
            }\n`
          );
          await this.safeFailureMark(
            () =>
              this.repository.markUpdateFailure(row.withdrawal_id),
            row.withdrawal_id
          );
        }
        await sleep(config.sendGapMs);
      }
    } finally {
      await this.repository.releaseLock(client).catch(() => undefined);
      client.release();
    }
  }

  private async updateWithRetry(updater: () => Promise<void>, row: WithdrawalRow, retries = 3): Promise<void> {
    let attempt = 0;
    while (attempt <= retries) {
      try {
        await updater();
        return;
      } catch (error) {
        if (attempt === retries) {
          await this.safeFailureMark(
            () =>
              this.repository.markTransientFailure(row.withdrawal_id),
            row.withdrawal_id
          );
          return;
        }
        await sleep(300 * 2 ** attempt);
        attempt += 1;
      }
    }
  }

  private async safeFailureMark(mark: () => Promise<void>, withdrawalId: number): Promise<void> {
    try {
      await mark();
    } catch (error) {
      process.stderr.write(
        `Failed to persist support worker error state for withdrawal ${withdrawalId}: ${String(error)}\n`
      );
    }
  }
}
