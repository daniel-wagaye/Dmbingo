import { apiClient } from './apiClient';

export interface User {
  telegram_id: number;
  phone_number: string | null;
  username: string | null;
  first_name: string | null;
  withdrawal_wallet: string;
  non_withdrawal_wallet: string;
  referral_count: number;
  last_referred_date: string | null;
  language: string;
  created_at: string;
}

export interface UserResponse extends User {
  registered?: boolean;
}

export async function fetchUser(): Promise<UserResponse> {
  return apiClient<UserResponse>('/api/user');
}

export async function registerUser(
  contactRaw: string,
  referralCode?: string
): Promise<User> {
  return apiClient<User>('/api/register', {
    method: 'POST',
    headers: {
      'X-Telegram-Contact-Raw': contactRaw,
    },
    body: {
      referral_code: referralCode || undefined,
    },
  });
}

export async function patchLanguage(
  language: 'en' | 'am'
): Promise<{ success: boolean; language: string }> {
  return apiClient<{ success: boolean; language: string }>('/api/user/language', {
    method: 'PATCH',
    body: { language },
  });
}

export async function patchName(
  firstName: string
): Promise<{ success: boolean; first_name: string }> {
  return apiClient<{ success: boolean; first_name: string }>('/api/user/name', {
    method: 'PATCH',
    body: { first_name: firstName },
  });
}