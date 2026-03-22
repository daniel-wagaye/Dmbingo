import { config } from '../../config';
import { sleep } from '../utils';

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

export class TelegramApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export class TelegramClient {
  private readonly baseUrl: string;
  private lastApiCallAt = 0;

  constructor() {
    this.baseUrl = `https://api.telegram.org/bot${config.supportBotToken}`;
  }

  private async enforceGap(): Promise<void> {
    const now = Date.now();
    const waitFor = config.sendGapMs - (now - this.lastApiCallAt);
    if (waitFor > 0) {
      await sleep(waitFor);
    }
  }

  private async callTelegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    while (attempt <= config.telegramApiMaxRetries) {
      await this.enforceGap();
      this.lastApiCallAt = Date.now();
      try {
        const response = await fetch(`${this.baseUrl}/${method}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = (await response.json()) as TelegramEnvelope<T>;
        if (data.ok && data.result !== undefined) {
          return data.result;
        }

        const retryAfterMs = (data.parameters?.retry_after ?? 0) * 1000;
        if ((response.status === 429 || response.status >= 500) && attempt < config.telegramApiMaxRetries) {
          const backoff = config.telegramRetryBaseDelayMs * 2 ** attempt;
          await sleep(Math.max(backoff, retryAfterMs));
          attempt += 1;
          continue;
        }

        const retryable = response.status === 429 || response.status >= 500;
        throw new TelegramApiError(
          data.description ?? `Telegram API call failed (${response.status})`,
          retryable
        );
      } catch (error) {
        if (error instanceof TelegramApiError) {
          throw error;
        }
        if (attempt < config.telegramApiMaxRetries) {
          const backoff = config.telegramRetryBaseDelayMs * 2 ** attempt;
          await sleep(backoff);
          attempt += 1;
          continue;
        }
        throw new TelegramApiError(
          error instanceof Error ? error.message : 'Unknown network error',
          true
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
