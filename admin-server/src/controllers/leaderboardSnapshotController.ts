import type { Request, Response } from 'express';
import { pool } from '../db/drizzle';
import { syncAllSnapshots, type SnapshotResult } from '../services/leaderboardSnapshotService';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const ensureSuperAdmin = (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  if (admin.role !== 'super_admin') {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return admin;
};

const LABELS: Record<SnapshotResult['period'], string> = {
  daily: 'Daily snapshot',
  weekly: 'Weekly snapshot',
  monthly: 'Monthly snapshot',
};

const summarize = (result: SnapshotResult): string => {
  if (!result.ok) return `${LABELS[result.period]}: failed`;
  return `${LABELS[result.period]}: ${result.updated ? 'updated' : 'already up to date'}`;
};

/**
 * Checks the latest completed day, week and month and rewrites only the ones that are
 * missing or no longer match `winners_history`. Repeating the call is a no-op.
 */
export const updateLeaderboardSnapshots = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const results = await syncAllSnapshots();
  const succeeded = results.every((r) => r.ok);
  const changed = results.some((r) => r.ok && r.updated);

  const details = JSON.stringify({
    success: succeeded,
    snapshots: results.map((r) => ({
      type: r.period,
      period_start: r.periodStart,
      rows_saved: r.rowsSaved,
      updated: r.updated,
      ok: r.ok,
      error: r.error ?? null,
    })),
  });

  try {
    await pool.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'update_leaderboard_snapshots', NULL, 'leaderboard_snapshot', $2::jsonb, $3, $4)`,
      [admin.adminId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );
  } catch (error) {
    // Audit logging must never hide the outcome of the snapshot work itself.
    process.stderr.write(`[leaderboardSnapshot] audit log failed: ${String(error)}\n`);
  }

  const lines = succeeded && !changed
    ? ['All leaderboard snapshots are up to date.']
    : results.map(summarize);

  return res.status(succeeded ? 200 : 500).json({
    status: succeeded ? 'ok' : 'partial_failure',
    changed,
    lines,
    results: results.map((r) => ({
      period: r.period,
      period_start: r.periodStart,
      rows_saved: r.rowsSaved,
      updated: r.updated,
      ok: r.ok,
    })),
  });
};
