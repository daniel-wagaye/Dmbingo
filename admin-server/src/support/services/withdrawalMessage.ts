import { config } from '../../config';
import type { WithdrawalRow } from '../types';
import { escapeHtml, formatDateTime } from '../utils';

const getStatusLabel = (status: WithdrawalRow['status']): string => {
  if (status === 'approved') {
    return '✅(approved)';
  }
  if (status === 'declined') {
    return '❌(declined)';
  }
  return '🟠(pending)';
};

const buildAdminUrl = (): string => config.adminViewBaseUrl;

export const buildWithdrawalMessage = (row: WithdrawalRow, reposted = false): string => {
  const title = reposted
    ? `💳 Withdrawal request ${row.withdrawal_id} (reposted)`
    : `💳 Withdrawal request ${row.withdrawal_id}`;
  const bankName = escapeHtml(row.bank ?? '-');
  const accountHolder = escapeHtml(row.account_holder_name ?? '-');
  const accountNumber = escapeHtml(row.account_num ?? '-');
  const amountValue = escapeHtml(`${row.amount} ETB`);
  const txNumber = escapeHtml(row.admin_tx_number ?? '-');
  const adminName = escapeHtml(row.admin_first_name ?? '-');
  const declineReason = escapeHtml(row.declined_reason ?? '-');

  return [
    title,
    `<blockquote>Telegram ID: ${row.telegram_id ?? '-'}\nStatus: ${getStatusLabel(row.status)}</blockquote>`,
    '',
    '🏦 Bank Details',
    `<blockquote>Bank: ${bankName}\nAccount Holder Name: <tg-spoiler>${accountHolder}</tg-spoiler>\nAccount Number: <tg-spoiler>${accountNumber}</tg-spoiler>\nAmount: <tg-spoiler>${amountValue}</tg-spoiler></blockquote>`,
    '',
    'ℹ️ Transaction Info',
    `<blockquote>Tx Number: ${txNumber}\nAdmin Name: ${adminName}\nDecline Reason: ${declineReason}\nRequested At: ${formatDateTime(row.created_at)}\nProcessed At: ${formatDateTime(row.processed_at)}</blockquote>`,
  ].join('\n');
};

export const buildWithdrawalInlineKeyboard = (): Record<string, unknown> => ({
  inline_keyboard: [[{ text: 'View in Admin', url: buildAdminUrl() }]],
});
