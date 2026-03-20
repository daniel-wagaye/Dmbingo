import { apiClient } from './apiClient';

export interface HistoryRow {
  type: 'withdraw' | 'transfer' | 'coupon' | 'win';
  title: string;
  amount: string;
  currency: string;
  bank?: string | null;
  account_num?: string | null;
  account_holder_name?: string | null;
  status?: string | null;
  wallet?: string | null;
  direction?: string | null;
  commission?: string | null;
  credit_wallet?: string | null;
  created_at: string;
}

export interface HistoryResponse {
  success: boolean;
  rows: HistoryRow[];
  next_cursor: string | null;
}

export async function fetchHistory(
  filter: string,
  limit: number,
  cursor: string | null
): Promise<HistoryResponse> {
  return apiClient<HistoryResponse>('/api/history', {
    method: 'POST',
    body: { filter, limit, cursor },
  });
}