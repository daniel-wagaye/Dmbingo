import { Router } from 'express';
import {
  forgot,
  login,
  logout,
  refresh,
  resetPassword,
  resendOtp,
  validateOtp,
  verifyEmail,
} from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);

router.post('/forgot', forgot);
router.post('/forgot/verify-email', verifyEmail);
router.post('/forgot/validate-otp', validateOtp);
router.post('/forgot/resend-otp', resendOtp);
router.post('/forgot/reset-password', resetPassword);

export default router;
