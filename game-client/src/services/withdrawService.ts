import { apiClient } from './apiClient';

export interface WithdrawRequest {
  amount: number;
  bank: string;
  account_holder_name: string;
  account_num: string;
}

export interface WithdrawResponse {
  success?: boolean;
  error?: string;
  message?: string;
}

export async function requestWithdrawal(data: WithdrawRequest): Promise<WithdrawResponse> {
  return apiClient<WithdrawResponse>('/api/withdrawals/request', {
    method: 'POST',
    body: data,
  });
}