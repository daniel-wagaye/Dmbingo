import crypto from 'crypto';

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface ParsedInitData {
  telegram_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  auth_date: number;
  hash: string;
  raw: string;
}

export function verifyTelegramInitData(initData: string, botToken: string): ParsedInitData | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    const dataCheckArr: string[] = [];
    params.forEach((val, key) => {
      dataCheckArr.push(`${key}=${val}`);
    });
    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (!timingSafeEqual(computedHash, hash)) return null;

    const userStr = params.get('user');
    if (!userStr) return null;

    const user = JSON.parse(userStr);

    return {
      telegram_id: user.id,
      username: user.username || undefined,
      first_name: user.first_name || undefined,
      last_name: user.last_name || undefined,
      language_code: user.language_code || undefined,
      auth_date: parseInt(params.get('auth_date') || '0', 10),
      hash,
      raw: initData,
    };
  } catch {
    return null;
  }
}

export interface ParsedContactData {
  telegram_id: number;
  phone_number: string;
}

export function verifyTelegramContact(contactRaw: string, botToken: string): ParsedContactData | null {
  try {
    const params = new URLSearchParams(contactRaw);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    const dataCheckArr: string[] = [];
    params.forEach((val, key) => {
      dataCheckArr.push(`${key}=${val}`);
    });
    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (!timingSafeEqual(computedHash, hash)) return null;

    const contactStr = params.get('contact');
    if (!contactStr) return null;

    const contact = JSON.parse(contactStr);

    return {
      telegram_id: contact.user_id,
      phone_number: contact.phone_number,
    };
  } catch {
    return null;
  }
}