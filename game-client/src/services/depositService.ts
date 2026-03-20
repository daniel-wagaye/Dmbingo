import { apiClient } from './apiClient';

export interface BankInfo {
  bank_name: string;
  account_number: string;
  account_holder_name: string;
}

export interface BankDataResponse {
  success: boolean;
  banks: BankInfo[];
}

export interface DepositValidateResponse {
  success: boolean;
  amount?: number;
  message?: string;
  error?: string;
}

export async function fetchBankData(): Promise<BankDataResponse> {
  return apiClient<BankDataResponse>('/api/deposits/banks');
}

export async function validateDeposit(txnReference: string): Promise<DepositValidateResponse> {
  return apiClient<DepositValidateResponse>('/api/deposits/validate', {
    method: 'POST',
    body: { txn_reference: txnReference },
  });
}

// SMS parser regexes (exact patterns from spec)
const CBE_RE = /https:\/\/apps\.cbe\.com\.et:100\/\?id=([A-Za-z0-9]+)/i;
const BOA_RE = /trx=([A-Za-z0-9]+)/i;
const CBEBIRR_RE = /Txn ID ([A-Za-z0-9]+)/i;
const TELEBIRR_RE = /transaction number is[:\s]+([A-Za-z0-9]+)/i;

export function parseSmsForTxnReference(sms: string): string | null {
  const patterns = [CBE_RE, BOA_RE, CBEBIRR_RE, TELEBIRR_RE];
  for (const re of patterns) {
    const match = sms.match(re);
    if (match && match[1]) return match[1];
  }
  return null;
}