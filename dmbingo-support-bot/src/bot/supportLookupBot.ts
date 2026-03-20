import { Telegraf } from 'telegraf';
import { config } from '../config/env';
import { LookupRepository } from '../db/lookupRepository';
import { SupportLookupService } from '../services/supportLookupService';

export class SupportLookupBot {
  private readonly bot: Telegraf;
  private readonly lookupService: SupportLookupService;

  constructor(repository: LookupRepository) {
    this.bot = new Telegraf(config.telegramBotToken);
    this.lookupService = new SupportLookupService(repository);
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.bot.on('text', async (ctx) => {
      const messageText = ctx.message.text?.trim() ?? '';
      if (!this.lookupService.isLookupMessage(messageText)) {
        return;
      }

      const supportTelegramId = ctx.from.id;
      if (this.lookupService.isRateLimited(supportTelegramId)) {
        await ctx.reply('Too many lookup requests. Please wait and try again.');
        return;
      }

      const targetTelegramId = Number.parseInt(messageText, 10);
      const response = await this.lookupService.buildLookupResponse(supportTelegramId, targetTelegramId);
      if (response === null) {
        return;
      }

      await ctx.reply(response, { parse_mode: 'HTML' });
    });
  }

  async launch(): Promise<void> {
    await this.bot.launch({ dropPendingUpdates: true });
  }

  async stop(signal: string): Promise<void> {
    this.bot.stop(signal);
  }
}
