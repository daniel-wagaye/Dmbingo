import { Request, Response } from 'express';
import { Telegraf } from 'telegraf';
import { findUserByTelegramId, registerUser, updateUserLanguage, updateUserName } from '../services/userService';
import { verifyTelegramContact } from '../utils/hmac';
import { config } from '../config';
import { isAllowed } from '../middlewares/rateLimitPerUser';

const bot = new Telegraf(config.botToken);

export async function getUser(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;
    const user = await findUserByTelegramId(telegramId);

    if (!user) {
      res.status(200).json({ registered: false, serverTime: Date.now() });
      return;
    }

    res.status(200).json({ ...user, serverTime: Date.now() });
  } catch (err) {
    console.error('[getUser]', err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong.' });
  }
}

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const initUser = req.telegramUser!;
    const contactRaw = req.header('X-Telegram-Contact-Raw');

    if (!contactRaw) {
      res.status(400).json({ error: 'MISSING_CONTACT', message: 'Contact data is required' });
      return;
    }

    const contact = verifyTelegramContact(contactRaw, config.botToken);
    if (!contact) {
      res.status(401).json({ error: 'AUTH_FAILED', message: 'Invalid contact data' });
      return;
    }

    if (initUser.telegram_id !== contact.telegram_id) {
      res.status(400).json({
        error: 'ID_MISMATCH',
        message: "Phone number and User telegram ID doesn't match",
      });
      return;
    }

    // Validate referral_code from body
    let referralCode: number | null = null;
    const rawCode = req.body?.referral_code;
    if (rawCode !== undefined && rawCode !== null) {
      const codeStr = String(rawCode);
      if (/^[0-9]{1,16}$/.test(codeStr)) {
        referralCode = parseInt(codeStr, 10);
      }
    }

    const result = await registerUser(
      initUser.telegram_id,
      initUser.username,
      initUser.first_name,
      contact.phone_number,
      referralCode
    );

    // Post-commit: send Telegram messages (fire-and-forget, don't block response)
    if (result.isNew) {
      sendWelcomeMessage(
        initUser.telegram_id,
        result.registrationBonus
      ).catch((e) => console.error('[sendWelcome]', e));

      if (result.referrerRewarded && referralCode) {
        sendReferralRewardMessage(
          referralCode,
          result.referredFirstName,
          result.referralAmount
        ).catch((e) => console.error('[sendReferralReward]', e));
      }
    }

    res.status(200).json(result.user);
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong.' });
  }
}

async function sendWelcomeMessage(telegramId: number, bonus: string): Promise<void> {
  try {
    const stickerId = config.registerStickerId?.trim();
    if (stickerId) {
      try {
        await bot.telegram.sendSticker(telegramId, stickerId);
      } catch (stickerErr) {
        console.error('[sendWelcomeMessage] Sticker failed:', stickerErr);
      }
    }
    await bot.telegram.sendMessage(
      telegramId,
      `🎉 በተሳካ ሁኔታ ተመዝግቧል! \n💰 ${bonus} ብር ጉርሻ ተሰጥቶዎታል!. \n     አሁኑኑ ይጫወቱ 🚀`,
      {
        message_effect_id: "5046509860389126442",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Join The Community", url: "https://t.me/DM_Bingo" }],
            [{ text: "Play 🎱", url: "https://t.me/dmbingobot/startapp" }]
          ]
        }
      } as any
    );
  } catch (e) {
    console.error('[sendWelcomeMessage]', e);
  }
}

async function sendReferralRewardMessage(
  referrerId: number,
  referredFirstName: string,
  amount: string
): Promise<void> {
  try {
    const stickerId = config.referralStickerId?.trim();
    if (stickerId) {
      try {
        await bot.telegram.sendSticker(referrerId, stickerId);
      } catch (stickerErr) {
        console.error('[sendReferralRewardMessage] Sticker failed:', stickerErr);
      }
    }
    await bot.telegram.sendMessage(
      referrerId,
      `🌟 በተሳካ ሁኔታ ${referredFirstName}ን ጋብዘዋል።\n💸 ${amount} ብር ወደ ዋሌትዎ ገቢ ሆኗል! 🎁\nተጨማሪ ሰዎችን በመጋበዝ ጉርሻዎችን ያግኙ! 🚀`,
      {
        message_effect_id: "5046509860389126442",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Join The Community", url: "https://t.me/DM_Bingo" }],
            [{ text: "መጫዎትዎን ይቀጥሉ 🎱", url: "https://t.me/dmbingobot/startapp" }]
          ]
        }
      } as any
    );
  } catch (e) {
    console.error('[sendReferralRewardMessage]', e);
  }
}

export async function patchLanguage(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;
    const newLang = req.body?.language;

    if (!['en', 'am'].includes(newLang)) {
      res.status(400).json({ error: 'INVALID_LANGUAGE' });
      return;
    }

    if (!isAllowed('language', telegramId, config.languageRateLimitWindowMs, config.languageRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });
      return;
    }

    const result = await updateUserLanguage(telegramId, newLang);
    if (!result) {
      res.status(400).json({ error: 'USER_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, language: result.language });
  } catch (err) {
    console.error('[patchLanguage]', err);
    res.status(500).json({ error: 'INTERNAL' });
  }
}

export async function patchName(req: Request, res: Response): Promise<void> {
  try {
    const telegramId = req.telegramUser!.telegram_id;
    let name = (req.body?.first_name || '').trim().slice(0, 12);

    if (name.length === 0) {
      name = 'Player';
    }

    const nameRegex = /^[\p{L}\s'\-]{1,12}$/u;
    if (!nameRegex.test(name)) {
      res.status(400).json({ error: 'INVALID_NAME', message: 'Name must be 1–12 letters, spaces, \'-\' or \'\' only' });
      return;
    }

    if (!isAllowed('name', telegramId, config.nameRateLimitWindowMs, config.nameRateLimitMax)) {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });
      return;
    }

    const result = await updateUserName(telegramId, name);
    if (!result) {
      res.status(400).json({ error: 'USER_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, first_name: result.first_name });
  } catch (err) {
    console.error('[patchName]', err);
    res.status(500).json({ error: 'INTERNAL' });
  }
}