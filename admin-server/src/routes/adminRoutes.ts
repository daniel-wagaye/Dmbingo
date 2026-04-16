import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { adminAuth, requireAdminRole } from '../middlewares/adminAuth';
import {
  createAdmin,
  listAdmins,
  updateAdmin,
  updateAdminStatus,
} from '../controllers/adminManagementController';
import { createBank, deleteBank, listBanks, updateBank } from '../controllers/bankController';
import {
  createCoupon,
  exportCouponHistoryCsv,
  exportCouponsCsv,
  finishCoupon,
  listCouponHistory,
  listCoupons,
} from '../controllers/couponController';
import { approveDeposit, createDeposit, listDeposits, rejectDeposit } from '../controllers/depositController';
import {
  getGameConfig,
  startGameStatus,
  stopGameStatus,
  updateGameConfig,
  wakeUpGame,
} from '../controllers/gameConfigController';
import {
  exportAdminCreditHistoryCsv,
  listAdminCreditHistory,
  listAdminActions,
  listReferralHistory,
  listTransferHistory,
  listWinnerHistory,
  exportWinnerHistoryCsv,
} from '../controllers/historyController';
import {
  createRegexConfig,
  deleteRegexConfig,
  listRegexConfigs,
  updateRegexConfig,
  wakeupRegexAcceptor,
} from '../controllers/regexConfigController';
import {
  sendSuperAdminEmailOtp,
  sendSuperAdminPasswordOtp,
  updateSuperAdminEmail,
  updateSuperAdminPassword,
  updateWithdrawalAdminPassword,
} from '../controllers/credentialController';
import {
  approveWithdrawal,
  declineWithdrawal,
  listWithdrawals,
} from '../controllers/withdrawController';
import { creditUser, listUsers } from '../controllers/userController';

const router = Router();

router.get('/me', adminAuth, (req, res) => {
  const admin = (req as typeof req & { admin?: { adminId: number; role: string } }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.json({ adminId: admin.adminId, role: admin.role });
});

const parseDateRange = (startDate?: string, endDate?: string) => {
  if (!startDate && !endDate) {
    return null;
  }
  if (!startDate || !endDate) {
    return { error: 'missing_date_range' as const };
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'invalid_date' as const };
  }
  if (end.getTime() < start.getTime()) {
    return { error: 'invalid_range' as const };
  }
  const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
};

const toNumber = (value: unknown) => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

router.get('/stats/summary', adminAuth, requireAdminRole(['super_admin']), async (_req, res) => {
  const [
    playersResult,
    gamesResult,
    depositsResult,
    withdrawalsResult,
    transferResult,
    gameProfitResult,
    pendingResult,
  ] =
    await Promise.all([
      db.execute(sql`SELECT COUNT(*) AS total_players FROM users`),
      db.execute(sql`SELECT COUNT(*) AS total_games FROM games`),
      db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) AS total_deposits FROM deposits WHERE status = 'approved'`
      ),
      db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) AS total_withdrawals FROM withdrawals_request WHERE status = 'approved'`
      ),
      db.execute(
        sql`SELECT COALESCE(SUM(commission), 0) AS total_commission FROM transfer_history`
      ),
      db.execute(
        sql`SELECT COALESCE(SUM(CASE WHEN house_profit::text = 'NaN' THEN 0 ELSE house_profit END), 0) AS total_game_profit FROM games`
      ),
      db.execute(
        sql`SELECT COUNT(*) AS pending_withdrawals FROM withdrawals_request WHERE status = 'pending'`
      ),
    ]);

  const thisMonthStart = await db.execute(
    sql`SELECT DATE_TRUNC('month', NOW()) AS month_start`
  );
  const monthStart = thisMonthStart.rows[0]?.month_start as Date;

  const [monthDepositsResult, monthWithdrawalsResult, monthTransferResult] = await Promise.all([
    db.execute(
      sql`SELECT COALESCE(SUM(amount), 0) AS month_deposits FROM deposits WHERE status = 'approved' AND created_at >= ${monthStart}`
    ),
    db.execute(
      sql`SELECT COALESCE(SUM(amount), 0) AS month_withdrawals FROM withdrawals_request WHERE status = 'approved' AND processed_at >= ${monthStart}`
    ),
    db.execute(
      sql`SELECT COALESCE(SUM(commission), 0) AS month_commission FROM transfer_history WHERE created_at >= ${monthStart}`
    ),
  ]);

  const totalDeposits = toNumber(depositsResult.rows[0]?.total_deposits);
  const totalWithdrawals = toNumber(withdrawalsResult.rows[0]?.total_withdrawals);
  const totalTransferCommissionProfit = toNumber(transferResult.rows[0]?.total_commission);
  const totalGameProfit = toNumber(gameProfitResult.rows[0]?.total_game_profit);
  const totalProfit = totalDeposits - totalWithdrawals + totalTransferCommissionProfit;

  const monthDeposits = toNumber(monthDepositsResult.rows[0]?.month_deposits);
  const monthWithdrawals = toNumber(monthWithdrawalsResult.rows[0]?.month_withdrawals);
  const monthTransferCommission = toNumber(monthTransferResult.rows[0]?.month_commission);
  const monthProfit = monthDeposits - monthWithdrawals + monthTransferCommission;

  return res.json({
    totals: {
      totalPlayers: toNumber(playersResult.rows[0]?.total_players),
      totalPlayedGames: toNumber(gamesResult.rows[0]?.total_games),
      totalDeposits,
      totalWithdrawals,
      totalTransferCommissionProfit,
      totalGameProfit,
      totalProfit,
    },
    monthly: {
      thisMonthWithdrawals: monthWithdrawals,
      thisMonthDeposits: monthDeposits,
      thisMonthProfit: monthProfit,
      pendingWithdrawals: toNumber(pendingResult.rows[0]?.pending_withdrawals),
    },
  });
});

router.post('/credentials/super/password/send-otp', adminAuth, sendSuperAdminPasswordOtp);
router.post('/credentials/super/password/update', adminAuth, updateSuperAdminPassword);
router.post('/credentials/super/email/send-otp', adminAuth, sendSuperAdminEmailOtp);
router.post('/credentials/super/email/update', adminAuth, updateSuperAdminEmail);
router.post('/credentials/withdrawal/password/update', adminAuth, updateWithdrawalAdminPassword);

router.get('/stats/:statKey', adminAuth, requireAdminRole(['super_admin']), async (req, res) => {
  const statKey = req.params.statKey;
  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
  const range = parseDateRange(startDate, endDate);
  if (range && 'error' in range) {
    return res.status(400).json({ error: range.error });
  }
  const start = range?.start;
  const endExclusive = range?.endExclusive;

  const dateClause = (column: string) => {
    if (!start || !endExclusive) {
      return sql``;
    }
    return sql` AND ${sql.raw(column)} >= ${start} AND ${sql.raw(column)} < ${endExclusive}`;
  };

  const resolveStat = async () => {
    switch (statKey) {
      case 'total_players': {
        const result = await db.execute(
          sql`SELECT COUNT(*) AS value FROM users WHERE 1=1${dateClause('created_at')}`
        );
        return toNumber(result.rows[0]?.value);
      }
      case 'total_games': {
        const result = await db.execute(
          sql`SELECT COUNT(*) AS value FROM games WHERE 1=1${dateClause('started_at')}`
        );
        return toNumber(result.rows[0]?.value);
      }
      case 'total_deposits': {
        const result = await db.execute(
          sql`SELECT COALESCE(SUM(amount), 0) AS value FROM deposits WHERE status = 'approved'${dateClause(
            'created_at'
          )}`
        );
        return toNumber(result.rows[0]?.value);
      }
      case 'total_withdrawals': {
        const result = await db.execute(
          sql`SELECT COALESCE(SUM(amount), 0) AS value FROM withdrawals_request WHERE status = 'approved'${dateClause(
            'processed_at'
          )}`
        );
        return toNumber(result.rows[0]?.value);
      }
      case 'total_transfer_commission_profit': {
        const result = await db.execute(
          sql`SELECT COALESCE(SUM(commission), 0) AS value FROM transfer_history WHERE 1=1${dateClause(
            'created_at'
          )}`
        );
        return toNumber(result.rows[0]?.value);
      }
      case 'total_game_profit': {
        const result = await db.execute(
          sql`SELECT COALESCE(SUM(CASE WHEN house_profit::text = 'NaN' THEN 0 ELSE house_profit END), 0) AS value FROM games WHERE 1=1${dateClause(
            'started_at'
          )}`
        );
        return toNumber(result.rows[0]?.value);
      }
      case 'total_profit': {
        const depositsResult = await db.execute(
          sql`SELECT COALESCE(SUM(amount), 0) AS value FROM deposits WHERE status = 'approved'${dateClause(
            'created_at'
          )}`
        );
        const withdrawalsResult = await db.execute(
          sql`SELECT COALESCE(SUM(amount), 0) AS value FROM withdrawals_request WHERE status = 'approved'${dateClause(
            'processed_at'
          )}`
        );
        const transferResult = await db.execute(
          sql`SELECT COALESCE(SUM(commission), 0) AS value FROM transfer_history WHERE 1=1${dateClause(
            'created_at'
          )}`
        );
        return (
          toNumber(depositsResult.rows[0]?.value) -
          toNumber(withdrawalsResult.rows[0]?.value) +
          toNumber(transferResult.rows[0]?.value)
        );
      }
      default:
        return null;
    }
  };

  const value = await resolveStat();
  if (value === null) {
    return res.status(404).json({ error: 'unknown_stat' });
  }
  return res.json({ value });
});

router.get('/users', adminAuth, listUsers);
router.post('/credit', adminAuth, creditUser);
router.get('/admins', adminAuth, listAdmins);
router.post('/admins', adminAuth, createAdmin);
router.put('/admins/:id', adminAuth, updateAdmin);
router.post('/admins/:id/status', adminAuth, updateAdminStatus);
router.get('/deposits', adminAuth, listDeposits);
router.post('/deposits/create', adminAuth, createDeposit);
router.post('/deposits/reject', adminAuth, rejectDeposit);
router.post('/deposits/approve', adminAuth, approveDeposit);
router.get('/withdrawals', adminAuth, listWithdrawals);
router.post('/withdrawals/approve', adminAuth, approveWithdrawal);
router.post('/withdrawals/decline', adminAuth, declineWithdrawal);
router.get('/banks', adminAuth, listBanks);
router.post('/banks', adminAuth, createBank);
router.put('/banks/:id', adminAuth, updateBank);
router.delete('/banks/:id', adminAuth, deleteBank);
router.get('/coupons', adminAuth, listCoupons);
router.get('/coupons/export', adminAuth, exportCouponsCsv);
router.post('/coupons', adminAuth, createCoupon);
router.post('/coupons/:id/finish', adminAuth, finishCoupon);
router.get('/coupons/history', adminAuth, listCouponHistory);
router.get('/coupons/history/export', adminAuth, exportCouponHistoryCsv);
router.get('/transfers', adminAuth, listTransferHistory);
router.get('/referrals', adminAuth, listReferralHistory);
router.get('/admin-credits', adminAuth, listAdminCreditHistory);
router.get('/admin-credits/export', adminAuth, exportAdminCreditHistoryCsv);
router.get('/winners', adminAuth, listWinnerHistory);
router.get('/winners/export', adminAuth, exportWinnerHistoryCsv);
router.get('/reports', adminAuth, listAdminActions);
router.get('/regex', adminAuth, listRegexConfigs);
router.post('/regex', adminAuth, createRegexConfig);
router.put('/regex/:id', adminAuth, updateRegexConfig);
router.delete('/regex/:id', adminAuth, deleteRegexConfig);
router.post('/regex/wakeup', adminAuth, wakeupRegexAcceptor);
router.get('/game-config', adminAuth, getGameConfig);
router.post('/game-config/update', adminAuth, updateGameConfig);
router.post('/game-status/start', adminAuth, startGameStatus);
router.post('/game-status/stop', adminAuth, stopGameStatus);
router.post('/game-control/start', adminAuth, wakeUpGame);

export default router;
