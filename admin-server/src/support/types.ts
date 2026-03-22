import type { Request } from 'express';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export type WithdrawalStatus = 'pending' | 'approved' | 'declined';
export type WithdrawalTextStatus = 'pending' | 'processing' | 'sent' | 'finished' | 'failed';

export interface WithdrawalRow {
  withdrawal_id: number;
  telegram_id: number | null;
  bank: string | null;
  account_holder_name: string | null;
  account_num: string | null;
  amount: string;
  status: WithdrawalStatus;
  declined_reason: string | null;
  admin_tx_number: string | null;
  admin_first_name: string | null;
  text_status: WithdrawalTextStatus;
  tg_message_id: number | null;
  attempts: number;
  created_at: Date;
  processed_at: Date | null;
  last_error: string | null;
}
