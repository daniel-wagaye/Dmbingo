import type { Pool } from 'pg';
import { config } from '../../config';

export interface LookupUserProfile {
  telegramId: number;
  firstName: string;
  username: string;
  phoneNumber: string;
  withdrawalWallet: string;
  nonWithdrawalWallet: string;
  referralCount: number;
  lastReferred: Date | null;
}

interface DepositRow {
  createdAt: Date;
  amount: string;
  status: string;
  bankName: string;
  txnReference: string;
}

interface WithdrawalRow {
  createdAt: Date;
  amount: string;
  status: string;
  declinedReason?: string | null;
  bankName: string;
  accountHolderName: string;
  adminTxNumber: string;
}

interface TransferRow {
  createdAt: Date;
  amount: string;
  sign: '+' | '-';
  counterpartPhone: string;
}

interface WinRow {
  wonAt: Date;
  creditedAmount: string;
}

interface ReferralRow {
  createdAt: Date;
  referredTelegramId: number | null;
  referredPhone: string;
  rewarded: boolean;
  rewardedAmount: string;
}

interface CouponRow {
  claimedAt: Date;
  couponCode: string;
  creditedAmount: string;
  creditWallet: string;
}

export interface LookupHistory {
  deposits: DepositRow[];
  withdrawals: WithdrawalRow[];
  transfers: TransferRow[];
  wins: WinRow[];
  referrals: ReferralRow[];
  coupons: CouponRow[];
}

interface UserProfileRow {
  telegram_id: string | number;
  first_name: string | null;
  username: string | null;
  phone_number: string | null;
  withdrawal_wallet: string | number | null;
  non_withdrawal_wallet: string | number | null;
  referral_count: number | null;
  last_referred_date: Date | string | null;
}

interface DepositHistoryRow {
  created_at: Date | string;
  amount: string | number | null;
  status: string | null;
  bank_name: string | null;
  txn_reference: string | null;
}

interface WithdrawalHistoryRow {
  created_at: Date | string;
  amount: string | number | null;
  status: string | null;
  declined_reason: string | null;
  bank_name: string | null;
  account_holder_name: string | null;
  admin_tx_number: string | null;
}

interface TransferHistoryRow {
  created_at: Date | string;
  amount: string | number | null;
  sign: '+' | '-';
  counterpart_phone: string | null;
}

interface WinHistoryRow {
  won_at: Date | string;
  credited_amount: string | number | null;
}

interface ReferralHistoryRow {
  created_at: Date | string;
  referred_user_id: string | number | null;
  rewarded: boolean | null;
  rewarded_amount: string | number | null;
  referred_phone: string | null;
}

interface CouponHistoryRow {
  claimed_at: Date | string;
  coupon_code: string | null;
  credited_amount: string | number | null;
  credit_wallet: string | null;
}

interface SupportLookupAccessRow {
  allowed: number;
}

export class LookupRepository {
  constructor(private readonly pool: Pool) {}

  async isSupportLookupAllowed(telegramId: number): Promise<boolean> {
    const result = await this.pool.query<SupportLookupAccessRow>(
      `
        SELECT 1 AS allowed
        FROM support_team_lookup
        WHERE telegram_id = $1
          AND is_active = TRUE
        LIMIT 1
      `,
      [telegramId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getUserProfile(telegramId: number): Promise<LookupUserProfile | null> {
    const result = await this.pool.query<UserProfileRow>(
      `
        SELECT telegram_id, first_name, username, phone_number, withdrawal_wallet, non_withdrawal_wallet,
               referral_count, last_referred_date
        FROM users
        WHERE telegram_id = $1
        LIMIT 1
      `,
      [telegramId]
    );

    if ((result.rowCount ?? 0) === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      telegramId: Number(row.telegram_id),
      firstName: row.first_name ?? '-',
      username: row.username ?? '-',
      phoneNumber: row.phone_number ?? '-',
      withdrawalWallet: Number(row.withdrawal_wallet ?? 0).toFixed(2),
      nonWithdrawalWallet: Number(row.non_withdrawal_wallet ?? 0).toFixed(2),
      referralCount: Number(row.referral_count ?? 0),
      lastReferred: row.last_referred_date ? new Date(row.last_referred_date) : null,
    };
  }

  async getUserHistory(telegramId: number, limit = config.lookupHistoryLimit): Promise<LookupHistory> {
    const [deposits, withdrawals, transfers, wins, referrals, coupons] = await Promise.all([
      this.pool.query<DepositHistoryRow>(
        `
          SELECT created_at, amount, status, bank_name, txn_reference
          FROM deposits
          WHERE telegram_id = $1
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [telegramId, limit]
      ),
      this.pool.query<WithdrawalHistoryRow>(
        `
          SELECT created_at, amount, status, declined_reason, bank_name, account_holder_name, admin_tx_number
          FROM withdrawals_request
          WHERE telegram_id = $1
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [telegramId, limit]
      ),
      this.pool.query<TransferHistoryRow>(
        `
          SELECT t.created_at,
                 t.amount,
                 CASE WHEN t.receiver_id = $1 THEN '+' ELSE '-' END AS sign,
                 u.phone_number AS counterpart_phone
          FROM transfer_history t
          LEFT JOIN users u
            ON u.telegram_id = CASE WHEN t.receiver_id = $1 THEN t.sender_id ELSE t.receiver_id END
          WHERE t.sender_id = $1 OR t.receiver_id = $1
          ORDER BY t.created_at DESC
          LIMIT $2
        `,
        [telegramId, limit]
      ),
      this.pool.query<WinHistoryRow>(
        `
          SELECT won_at, credited_amount
          FROM winners_history
          WHERE telegram_id = $1
          ORDER BY won_at DESC
          LIMIT $2
        `,
        [telegramId, limit]
      ),
      this.pool.query<ReferralHistoryRow>(
        `
          SELECT rh.created_at,
                 rh.referred_user_id,
                 rh.rewarded,
                 rh.rewarded_amount,
                 u.phone_number AS referred_phone
          FROM referrals_history rh
          LEFT JOIN users u ON u.telegram_id = rh.referred_user_id
          WHERE rh.referrer_id = $1
          ORDER BY rh.created_at DESC
          LIMIT $2
        `,
        [telegramId, limit]
      ),
      this.pool.query<CouponHistoryRow>(
        `
          SELECT ch.claimed_at,
                 c.coupon_code,
                 ch.credited_amount,
                 ch.credit_wallet
          FROM coupon_history ch
          LEFT JOIN coupons c ON c.coupon_id = ch.coupon_id
          WHERE ch.user_telegram_id = $1
          ORDER BY ch.claimed_at DESC
          LIMIT $2
        `,
        [telegramId, limit]
      ),
    ]);

    return {
      deposits: deposits.rows.map((row) => ({
        createdAt: new Date(row.created_at),
        amount: Number(row.amount ?? 0).toFixed(2),
        status: row.status ?? '-',
        bankName: row.bank_name ?? '-',
        txnReference: row.txn_reference ?? '-',
      })),
      withdrawals: withdrawals.rows.map((row) => ({
        createdAt: new Date(row.created_at),
        amount: Number(row.amount ?? 0).toFixed(2),
        status: row.status ?? '-',
        declinedReason: row.declined_reason ?? null,
        bankName: row.bank_name ?? '-',
        accountHolderName: row.account_holder_name ?? '-',
        adminTxNumber: row.admin_tx_number ?? '-',
      })),
      transfers: transfers.rows.map((row) => ({
        createdAt: new Date(row.created_at),
        amount: Number(row.amount ?? 0).toFixed(2),
        sign: row.sign === '+' ? '+' : '-',
        counterpartPhone: row.counterpart_phone ?? '-',
      })),
      wins: wins.rows.map((row) => ({
        wonAt: new Date(row.won_at),
        creditedAmount: Number(row.credited_amount ?? 0).toFixed(2),
      })),
      referrals: referrals.rows.map((row) => ({
        createdAt: new Date(row.created_at),
        referredTelegramId: row.referred_user_id === null ? null : Number(row.referred_user_id),
        referredPhone: row.referred_phone ?? '-',
        rewarded: row.rewarded === true,
        rewardedAmount: Number(row.rewarded_amount ?? 0).toFixed(2),
      })),
      coupons: coupons.rows.map((row) => ({
        claimedAt: new Date(row.claimed_at),
        couponCode: row.coupon_code ?? '-',
        creditedAmount: Number(row.credited_amount ?? 0).toFixed(2),
        creditWallet: row.credit_wallet ?? '-',
      })),
    };
  }
}
