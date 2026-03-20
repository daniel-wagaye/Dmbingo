import { sql } from '../db/drizzle';
import type { Sql } from 'postgres';

export interface UserRow {
  telegram_id: number;
  phone_number: string | null;
  username: string | null;
  first_name: string | null;
  withdrawal_wallet: string;
  non_withdrawal_wallet: string;
  referral_count: number;
  last_referred_date: Date | null;
  language: string;
  created_at: Date;
}

export async function findUserByTelegramId(telegramId: number): Promise<UserRow | null> {
  const rows = await sql`
    SELECT * FROM users WHERE telegram_id = ${telegramId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as UserRow;
}

export interface RegisterResult {
  user: UserRow;
  isNew: boolean;
  referrerRewarded: boolean;
  referralAmount: string;
  registrationBonus: string;
  referredFirstName: string;
}

export async function registerUser(
  telegramId: number,
  username: string | undefined,
  firstName: string | undefined,
  phoneNumber: string,
  referralCode: number | null
): Promise<RegisterResult> {
  const safeUsername = username || 'Player';
  const safeFirstName = (firstName || 'Player').slice(0, 12);
  const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber : '+' + phoneNumber;

  let isNew = false;
  let referrerRewarded = false;
  let referralAmount = '0';
  let registrationBonus = '0';

  const result = await sql.begin(async (tx: any) => {
    // 1. Fetch game_config
    const configRows = await tx`
      SELECT registration_bonus, referral_amount, referral_monthly_limit
      FROM game_config WHERE id = 1
    `;
    if (configRows.length === 0) {
      throw new Error('game_config row not found');
    }
    const regBonus = configRows[0].registration_bonus;
    const refAmt = configRows[0].referral_amount;
    const refLimit = configRows[0].referral_monthly_limit;
    registrationBonus = regBonus;
    referralAmount = refAmt;

    // 2. Idempotency check: user already exists by telegram_id
    const existingById = await tx`
      SELECT * FROM users WHERE telegram_id = ${telegramId} LIMIT 1
    `;
    if (existingById.length > 0) {
      return existingById[0] as unknown as UserRow;
    }

    // 3. Check if phone_number already exists (different telegram_id)
    const existingByPhone = await tx`
      SELECT * FROM users WHERE phone_number = ${normalizedPhone} LIMIT 1
    `;
    if (existingByPhone.length > 0) {
      // Update existing user with new telegram_id
      const updated = await tx`
        UPDATE users
        SET telegram_id = ${telegramId},
            username = ${safeUsername},
            first_name = ${safeFirstName}
        WHERE phone_number = ${normalizedPhone}
        RETURNING *
      `;
      return updated[0] as unknown as UserRow;
    }

    // 4. Create new user
    isNew = true;
    const inserted = await tx`
      INSERT INTO users (
        telegram_id, phone_number, username, first_name,
        non_withdrawal_wallet, referral_count, last_referred_date, created_at
      ) VALUES (
        ${telegramId}, ${normalizedPhone}, ${safeUsername}, ${safeFirstName},
        ${regBonus}, 0, NULL, NOW()
      )
      RETURNING *
    `;

    // 5. Handle referral if provided and not self-referral
    if (referralCode !== null && referralCode !== telegramId) {
      // Lock the referrer row
      const referrerRows = await tx`
        SELECT * FROM users
        WHERE telegram_id = ${referralCode}
        FOR UPDATE
      `;

      if (referrerRows.length > 0) {
        const referrer = referrerRows[0];
        let currentRefCount = referrer.referral_count as number;
        
        const lastRefDateRaw = referrer.last_referred_date;
        const lastRefDate = lastRefDateRaw ? new Date(lastRefDateRaw) : null;
        // Reset referral count if month changed or first referral
        const now = new Date();
        if (
          lastRefDate === null ||
          lastRefDate.getMonth() !== now.getMonth() ||
          lastRefDate.getFullYear() !== now.getFullYear()
        ) {
          await tx`
            UPDATE users
            SET referral_count = 0, last_referred_date = NOW()
            WHERE telegram_id = ${referralCode}
          `;
          currentRefCount = 0;
        }

        if (currentRefCount < refLimit) {
          // Credit referrer
          referrerRewarded = true;
          await tx`
            UPDATE users
            SET non_withdrawal_wallet = non_withdrawal_wallet + ${refAmt}::numeric,
                referral_count = referral_count + 1,
                last_referred_date = NOW()
            WHERE telegram_id = ${referralCode}
          `;

          // Insert rewarded referral history
          await tx`
            INSERT INTO referrals_history (
              referrer_id, referred_user_id, rewarded, rewarded_amount, created_at
            ) VALUES (
              ${referralCode}, ${telegramId}, TRUE, ${refAmt}, NOW()
            )
          `;
        } else {
          // Monthly limit exceeded: insert unrewarded history
          await tx`
            INSERT INTO referrals_history (
              referrer_id, referred_user_id, rewarded, rewarded_amount, created_at
            ) VALUES (
              ${referralCode}, ${telegramId}, FALSE, 0, NOW()
            )
          `;
        }
      }
      // If referrer not found, ignore referral silently
    }

    return inserted[0] as unknown as UserRow;
  });

  return {
    user: result,
    isNew,
    referrerRewarded,
    referralAmount,
    registrationBonus,
    referredFirstName: safeFirstName,
  };
}

export async function updateUserLanguage(
  telegramId: number,
  language: string
): Promise<{ language: string } | null> {
  const result = await sql.begin(async (tx: any) => {
    const rows = await tx`
      UPDATE users SET language = ${language}
      WHERE telegram_id = ${telegramId}
      RETURNING language
    `;
    if (rows.length === 0) return null;
    return { language: rows[0].language as string };
  });
  return result;
}

export async function updateUserName(
  telegramId: number,
  firstName: string
): Promise<{ first_name: string } | null> {
  const result = await sql.begin(async (tx: any) => {
    const rows = await tx`
      UPDATE users SET first_name = ${firstName}
      WHERE telegram_id = ${telegramId}
      RETURNING first_name
    `;
    if (rows.length === 0) return null;
    return { first_name: rows[0].first_name as string };
  });
  return result;
}