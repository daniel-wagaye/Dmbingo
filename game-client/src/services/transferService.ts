import { apiClient } from './apiClient';

export interface TransferRequest {
  from_wallet: 'withdrawal';
  amount: number;
  recipient_phone: string;
}

export interface TransferResponse {
  success?: boolean;
  amount?: number;
  commission?: number;
  phone?: string;
  error?: string;
  message?: string;
}

export async function sendTransfer(data: TransferRequest): Promise<TransferResponse> {
  return apiClient<TransferResponse>('/api/transfers/send', {
    method: 'POST',
    body: data,
  });
}