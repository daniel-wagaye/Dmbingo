import { Telegraf } from 'telegraf';
import { config } from '../config';

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; url: string }>> };
type SendTextOptions = {
  replyMarkup?: InlineKeyboard;
  messageEffectId?: string;
};

const bot = config.telegramBotToken ? new Telegraf(config.telegramBotToken) : null;

const resolveSendTextOptions = (
  input?: InlineKeyboard | SendTextOptions
): { replyMarkup?: InlineKeyboard; messageEffectId?: string } => {
  if (!input) {
    return {};
  }
  if ('inline_keyboard' in input) {
    return { replyMarkup: input };
  }
  return {
    replyMarkup: input.replyMarkup,
    messageEffectId: input.messageEffectId,
  };
};

export const sendUserTelegramText = async (
  telegramId: number,
  text: string,
  options?: InlineKeyboard | SendTextOptions
): Promise<void> => {
  if (!bot) {
    return;
  }
  const resolved = resolveSendTextOptions(options);
  const sendPayload = {
    reply_markup: resolved.replyMarkup,
    ...(resolved.messageEffectId ? { message_effect_id: resolved.messageEffectId } : {}),
  };
  await bot.telegram.sendMessage(telegramId, text, sendPayload as never).catch(() => null);
};

export const sendUserTelegramPhoto = async (
  telegramId: number,
  imageFileId: string,
  caption: string,
  replyMarkup?: InlineKeyboard
): Promise<void> => {
  if (!bot) {
    return;
  }
  await bot.telegram
    .sendPhoto(
      telegramId,
      imageFileId,
      {
        caption,
        reply_markup: replyMarkup,
      }
    )
    .catch(() => null);
};
