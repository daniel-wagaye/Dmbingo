import { config } from '../../config';
import { Telegraf } from 'telegraf';
import { sleep } from '../utils';

export class TelegramApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export class TelegramClient {
  private readonly bot: Telegraf;
  private lastApiCallAt = 0;

  constructor() {
    this.bot = new Telegraf(config.supportBotToken);
  }

  private async enforceGap(): Promise<void> {
    const now = Date.now();
    const waitFor = config.sendGapMs - (now - this.lastApiCallAt);
    if (waitFor > 0) {
      await sleep(waitFor);
    }
  }

  private getRetryAfterMs(error: unknown): number {
    const candidate = error as {
      parameters?: { retry_after?: number };
      response?: { parameters?: { retry_after?: number } };
    };
    const retryAfter = candidate.parameters?.retry_after ?? candidate.response?.parameters?.retry_after ?? 0;
    return Math.max(0, retryAfter) * 1000;
  }

  private getTelegramStatusCode(error: unknown): number {
    const candidate = error as {
      code?: number;
      statusCode?: number;
      response?: { error_code?: number };
    };
    return candidate.code ?? candidate.statusCode ?? candidate.response?.error_code ?? 0;
  }

  private async callTelegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    while (attempt <= config.telegramApiMaxRetries) {
      await this.enforceGap();
      this.lastApiCallAt = Date.now();
      try {
        return (await this.bot.telegram.callApi(method as never, payload as never)) as T;
      } catch (error) {
        if (error instanceof TelegramApiError) {
          throw error;
        }
        const statusCode = this.getTelegramStatusCode(error);
        const retryAfterMs = this.getRetryAfterMs(error);
        if ((statusCode === 429 || statusCode >= 500) && attempt < config.telegramApiMaxRetries) {
          const backoff = config.telegramRetryBaseDelayMs * 2 ** attempt;
          await sleep(Math.max(backoff, retryAfterMs));
          attempt += 1;
          continue;
        }
        if (attempt < config.telegramApiMaxRetries) {
          const backoff = config.telegramRetryBaseDelayMs * 2 ** attempt;
          await sleep(backoff);
          attempt += 1;
          continue;
        }
        const retryable = statusCode === 429 || statusCode >= 500;
        throw new TelegramApiError(
          error instanceof Error ? error.message : 'Unknown Telegram error',
          retryable
        );
      }
    }

    throw new TelegramApiError('Telegram retry limit reached', true);
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    replyMarkup?: Record<string, unknown>
  ): Promise<{ message_id: number }> {
    return this.callTelegram('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    replyMarkup?: Record<string, unknown>
  ): Promise<{ message_id: number }> {
    return this.callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  }

  async deleteMessage(chatId: number | string, messageId: number): Promise<boolean> {
    try {
      await this.callTelegram('deleteMessage', {
        chat_id: chatId,
        message_id: messageId,
      });
      return true;
    } catch {
      return false;
    }
  }
}
