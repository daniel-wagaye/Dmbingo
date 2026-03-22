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

const buildAdminUrl = (withdrawalId: number): string => {
  if (config.adminViewBaseUrl.includes('{withdrawal_id}')) {
    return config.adminViewBaseUrl.replace('{withdrawal_id}', String(withdrawalId));
  }
  return `${config.adminViewBaseUrl.replace(/\/$/, '')}/${withdrawalId}`;
};

export const buildWithdrawalMessage = (row: WithdrawalRow, reposted = false): string => {
  const title = reposted
    ? `💳 Withdrawal request ${row.withdrawal_id} (reposted)`
    : `💳 Withdrawal request ${row.withdrawal_id}`;

  return [
    title,
    `Telegram ID: ${row.telegram_id ?? '-'}`,
    `Status: ${getStatusLabel(row.status)}`,
    '',
    '🏦 Bank Details',
    `Bank: ${escapeHtml(row.bank ?? '-')}`,
    `Account Holder Name: ${escapeHtml(row.account_holder_name ?? '-')}`,
    `Account Number: ${escapeHtml(row.account_num ?? '-')}`,
    `Amount: ${row.amount} ETB`,
    '',
    'ℹ️ Transaction Info',
    `Tx Number: ${escapeHtml(row.admin_tx_number ?? '-')}`,
    `Admin Name: ${escapeHtml(row.admin_first_name ?? '-')}`,
    `Decline Reason: ${escapeHtml(row.declined_reason ?? '-')}`,
    `Requested At: ${formatDateTime(row.created_at)}`,
    `Processed At: ${formatDateTime(row.processed_at)}`,
  ].join('\n');
};

export const buildWithdrawalInlineKeyboard = (withdrawalId: number): Record<string, unknown> => ({
  inline_keyboard: [[{ text: 'View in Admin', url: buildAdminUrl(withdrawalId) }]],
});
