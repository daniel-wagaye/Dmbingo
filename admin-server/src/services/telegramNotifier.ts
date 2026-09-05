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

export class TelegramDeliveryError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'TelegramDeliveryError';
    this.reason = reason;
  }
}

const telegramErrorText = (err: unknown): string => {
  if (!err || typeof err !== 'object') {
    return '';
  }
  const record = err as {
    response?: { description?: string; error_code?: number };
    description?: string;
    message?: string;
  };
  return String(record.response?.description ?? record.description ?? record.message ?? '');
};

export const mapTelegramDeliveryError = (err: unknown): TelegramDeliveryError => {
  const text = telegramErrorText(err);
  const lower = text.toLowerCase();

  if (lower.includes('blocked by the user')) {
    return new TelegramDeliveryError(
      'blocked',
      'Message failed because the user blocked the bot.'
    );
  }
  if (lower.includes("can't initiate conversation") || lower.includes('bot can\'t initiate conversation')) {
    return new TelegramDeliveryError(
      'not_started',
      'Message failed because the user has not started the bot.'
    );
  }
  if (lower.includes('chat not found') || lower.includes('peer_id_invalid')) {
    return new TelegramDeliveryError(
      'not_started',
      'Message failed because the user has not started the bot or the chat was not found.'
    );
  }
  if (lower.includes('user is deactivated') || lower.includes('user not found')) {
    return new TelegramDeliveryError(
      'deactivated',
      'Message failed because this Telegram account is deactivated.'
    );
  }
  if (lower.includes('bot was kicked')) {
    return new TelegramDeliveryError(
      'kicked',
      'Message failed because the bot was removed from the chat.'
    );
  }
  if (lower.includes('too many requests') || lower.includes('retry after') || lower.includes('flood')) {
    return new TelegramDeliveryError(
      'rate_limited',
      'Message failed because Telegram is rate-limiting. Try again in a moment.'
    );
  }
  if (text.trim()) {
    return new TelegramDeliveryError('telegram_rejected', `Message failed: ${text.trim()}`);
  }
  return new TelegramDeliveryError('unknown', 'Message failed. Telegram rejected it.');
};

const PHOTO_CAPTION_MAX = 1024;

export const sendDirectUserMessage = async (params: {
  telegramId: number;
  text?: string;
  imageJpeg?: Buffer;
}): Promise<void> => {
  if (!bot) {
    throw new TelegramDeliveryError(
      'bot_not_configured',
      'Message failed because the Telegram bot is not configured.'
    );
  }

  const text = params.text?.trim() ?? '';
  const image = params.imageJpeg;

  try {
    if (image && image.length > 0) {
      const caption = text ? text.slice(0, PHOTO_CAPTION_MAX) : undefined;
      await bot.telegram.sendPhoto(
        params.telegramId,
        { source: image, filename: 'photo.jpg' },
        caption ? { caption } : {}
      );
      return;
    }

    await bot.telegram.sendMessage(params.telegramId, text);
  } catch (err) {
    throw mapTelegramDeliveryError(err);
  }
};

const requireBot = () => {
  if (!bot) {
    throw new TelegramDeliveryError(
      'bot_not_configured',
      'Message failed because the Telegram bot is not configured.'
    );
  }
  return bot;
};

const requireCouponGroupChatId = (): number => {
  const raw = config.couponGroupChatId.trim();
  const chatId = Number(raw);
  if (!raw || !Number.isFinite(chatId)) {
    throw new TelegramDeliveryError(
      'group_not_configured',
      'Message failed because COUPON_GROUP_CHAT_ID is not set.'
    );
  }
  return chatId;
};

export const COUPON_WINNERS_CAPTION = 'የኩፖኑ ተሸላሚዎች 🎁☝️\nተጠናቋል ✅';

export const sendGroupDocument = async (params: {
  filename: string;
  bytes: Buffer;
  caption: string;
}): Promise<void> => {
  const telegram = requireBot();
  const chatId = requireCouponGroupChatId();
  try {
    await telegram.telegram.sendDocument(
      chatId,
      { source: params.bytes, filename: params.filename },
      { caption: params.caption }
    );
  } catch (err) {
    throw mapTelegramDeliveryError(err);
  }
};

export const sendGroupAnnouncement = async (params: {
  text: string;
  imageUrl?: string;
  imageJpeg?: Buffer;
}): Promise<void> => {
  const telegram = requireBot();
  const chatId = requireCouponGroupChatId();
  const text = params.text.trim();
  const jpeg = params.imageJpeg;
  const imageUrl = params.imageUrl?.trim();

  try {
    if (jpeg && jpeg.length > 0) {
      const caption = text ? text.slice(0, PHOTO_CAPTION_MAX) : undefined;
      await telegram.telegram.sendPhoto(
        chatId,
        { source: jpeg, filename: 'coupon.jpg' },
        caption ? { caption } : {}
      );
      if (text.length > PHOTO_CAPTION_MAX) {
        await telegram.telegram.sendMessage(chatId, text.slice(PHOTO_CAPTION_MAX));
      }
      return;
    }

    if (imageUrl) {
      const caption = text ? text.slice(0, PHOTO_CAPTION_MAX) : undefined;
      await telegram.telegram.sendPhoto(chatId, imageUrl, caption ? { caption } : {});
      if (text.length > PHOTO_CAPTION_MAX) {
        await telegram.telegram.sendMessage(chatId, text.slice(PHOTO_CAPTION_MAX));
      }
      return;
    }

    if (!text) {
      throw new TelegramDeliveryError('empty_message', 'Enter a message or attach a photo.');
    }
    await telegram.telegram.sendMessage(chatId, text);
  } catch (err) {
    if (err instanceof TelegramDeliveryError) throw err;
    throw mapTelegramDeliveryError(err);
  }
};
