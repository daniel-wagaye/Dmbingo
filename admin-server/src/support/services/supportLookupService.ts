import { config } from '../../config';
import type { LookupHistory, LookupUserProfile } from '../db/lookupRepository';
import { LookupRepository } from '../db/lookupRepository';
import { escapeHtml, formatDateTime } from '../utils';

interface LookupLimiterBucket {
  count: number;
  resetAt: number;
}

const lookupBuckets = new Map<number, LookupLimiterBucket>();
const lookupRegex = /^\d{5,15}$/;

const toSpoiler = (value: string): string => {
  if (!value || value === '-') {
    return '-';
  }
  return `<tg-spoiler>${escapeHtml(value)}</tg-spoiler>`;
};

const quoteSection = (title: string, rows: string[]): string[] => [
  `<b>${escapeHtml(title)}</b>`,
  `<blockquote>${rows.length > 0 ? rows.join('\n') : '-'}</blockquote>`,
];

const renderProfile = (profile: LookupUserProfile): string[] => {
  const lines = [
    `Telegram ID: ${profile.telegramId}`,
    `Name: ${escapeHtml(profile.firstName)}`,
    `Username: ${escapeHtml(profile.username)}`,
    `Phone: ${toSpoiler(profile.phoneNumber)}`,
    `Withdrawal Wallet: ${escapeHtml(profile.withdrawalWallet)}`,
    `Non-Withdrawal Wallet: ${escapeHtml(profile.nonWithdrawalWallet)}`,
    `Referral Count: ${profile.referralCount}`,
    `Last Referred: ${escapeHtml(formatDateTime(profile.lastReferred))}`,
  ];
  return ['<b>👤 User Profile</b>', `<blockquote>${lines.join('\n')}</blockquote>`];
};

const renderHistory = (history: LookupHistory, historyLimit: number): string[] => {
  const depositRows = history.deposits.map(
    (row) =>
      `${escapeHtml(formatDateTime(row.createdAt))} | ${escapeHtml(row.amount)} | ${escapeHtml(row.status)} | Bank: ${escapeHtml(row.bankName)} | Txn: ${escapeHtml(row.txnReference)}`
  );
  const withdrawalRows = history.withdrawals.map(
    (row) =>
      `${escapeHtml(formatDateTime(row.createdAt))} | ${escapeHtml(row.amount)} | ${escapeHtml(
        row.status
      )} | Bank: ${escapeHtml(row.bankName)} | Holder: ${escapeHtml(row.accountHolderName)} | AdminTx: ${escapeHtml(row.adminTxNumber)} | ${escapeHtml(row.declinedReason ?? '-')}`
  );
  const transferRows = history.transfers.map(
    (row) =>
      `${escapeHtml(formatDateTime(row.createdAt))} | ${escapeHtml(row.sign)}${escapeHtml(row.amount)} | ${toSpoiler(row.counterpartPhone)}`
  );
  const winRows = history.wins.map(
    (row) => `${escapeHtml(formatDateTime(row.wonAt))} | ${escapeHtml(row.creditedAmount)}`
  );
  const referralRows = history.referrals.map(
    (row) =>
      `${escapeHtml(formatDateTime(row.createdAt))} | referred: ${row.referredTelegramId ?? '-'} | phone: ${toSpoiler(row.referredPhone)} | rewarded: ${row.rewarded ? 'yes' : 'no'} | amount: ${escapeHtml(row.rewardedAmount)}`
  );
  const couponRows = history.coupons.map(
    (row) =>
      `${escapeHtml(formatDateTime(row.claimedAt))} | code: ${escapeHtml(row.couponCode)} | amount: ${escapeHtml(row.creditedAmount)} | wallet: ${escapeHtml(row.creditWallet)}`
  );

  return [
    ...quoteSection(`Deposits (last ${historyLimit})`, depositRows),
    ...quoteSection(`Withdrawals (last ${historyLimit})`, withdrawalRows),
    ...quoteSection(`Transfers (last ${historyLimit})`, transferRows),
    ...quoteSection(`Wins (last ${historyLimit})`, winRows),
    ...quoteSection(`Referrals (last ${historyLimit})`, referralRows),
    ...quoteSection(`Coupons (last ${historyLimit})`, couponRows),
  ];
};

export class SupportLookupService {
  constructor(private readonly repository: LookupRepository) {}

  isLookupMessage(text: string): boolean {
    return lookupRegex.test(text.trim());
  }

  isRateLimited(supportTelegramId: number): boolean {
    const now = Date.now();
    const existing = lookupBuckets.get(supportTelegramId);
    if (!existing || now > existing.resetAt) {
      lookupBuckets.set(supportTelegramId, {
        count: 1,
        resetAt: now + config.lookupWindowMs,
      });
      return false;
    }
    if (existing.count >= config.lookupMaxRequests) {
      return true;
    }
    existing.count += 1;
    lookupBuckets.set(supportTelegramId, existing);
    return false;
  }

  async buildLookupResponse(supportTelegramId: number, targetTelegramId: number): Promise<string | null> {
    const allowed = await this.repository.isSupportLookupAllowed(supportTelegramId);
    if (!allowed) {
      return null;
    }

    const profile = await this.repository.getUserProfile(targetTelegramId);
    if (!profile) {
      return "👤 User doesn't exist";
    }

    const history = await this.repository.getUserHistory(targetTelegramId, config.lookupHistoryLimit);
    return [...renderProfile(profile), '', ...renderHistory(history, config.lookupHistoryLimit)].join('\n');
  }
}
