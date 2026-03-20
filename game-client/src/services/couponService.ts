import { apiClient } from './apiClient';

export interface CouponRedeemResponse {
  success: boolean;
  coupon_prize?: number;
  credited_amount?: number;
  credit_wallet?: string;
  coupon_code?: string;
  message?: string;
  error?: string;
}

export async function redeemCoupon(couponCode: string): Promise<CouponRedeemResponse> {
  return apiClient<CouponRedeemResponse>('/api/coupons/redeem', {
    method: 'POST',
    body: { coupon_code: couponCode },
  });
}