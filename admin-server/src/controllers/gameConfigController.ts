import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { config } from '../config';
import { pool } from '../db/drizzle';

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

const fetchAdminActionHash = async (adminId: number) => {
  const result = await pool.query(
    `SELECT admin_id, first_name, action_password_hash FROM admins WHERE admin_id = $1`,
    [adminId]
  );
  return result.rows[0] as
    | { admin_id: number; first_name: string | null; action_password_hash: string }
    | undefined;
};

const resolveGameControlUrl = (baseUrl: string) => {
  const normalized = baseUrl.trim().replace(/\/$/, '');
  if (normalized.endsWith('/internal/game-control')) {
    return normalized;
  }
  return `${normalized}/internal/game-control`;
};

const postGameControlStart = async () => {
  if (!config.gameServerUrl || !config.gameServerSecret) {
    return { ok: false, status: 500, error: 'missing_game_server_config' as const };
  }
  const gameControlUrl = resolveGameControlUrl(config.gameServerUrl);
  const response = await fetch(gameControlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Game-Secret': config.gameServerSecret,
    },
    body: JSON.stringify({ game: 'Start' }),
  }).catch(() => null);
  if (!response) {
    return { ok: false, status: 502, error: 'game_server_unreachable' as const };
  }
  if (response.ok) {
    return { ok: true, status: response.status };
  }
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return { ok: false, status: response.status, error: data.error ?? 'unknown_error', message: data.message };
};

export const getGameConfig = async (_req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO game_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO game_status (id, status) VALUES (1, 'stopped') ON CONFLICT (id) DO NOTHING`);

    const configResult = await client.query(
      `SELECT stake_amount, picking_countdown_end_time, minimum_player, referral_amount,
              referral_monthly_limit, registration_bonus, bot_status, max_bot_amount, min_bot_amount,
              streak_bonus_5_days, streak_bonus_10_days, streak_bonus_30_days, last_updated
       FROM game_config WHERE id = 1`
    );
    const statusResult = await client.query(
      `SELECT status, updated_at FROM game_status WHERE id = 1`
    );
    await client.query('COMMIT');

    return res.json({
      config: configResult.rows[0],
      status: statusResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

const MAX_BOT_ACCOUNTS = 100;

type ConfigFieldKind = 'integer' | 'money' | 'on_off';

const allowedFields = new Map<string, { action: string; kind: ConfigFieldKind }>([
  ['stake_amount', { action: 'update_stake', kind: 'integer' }],
  ['picking_countdown_end_time', { action: 'update_picking_countdown', kind: 'integer' }],
  ['minimum_player', { action: 'update_minimum_player', kind: 'integer' }],
  ['referral_amount', { action: 'update_referral_amount', kind: 'integer' }],
  ['referral_monthly_limit', { action: 'update_referral_monthly_limit', kind: 'integer' }],
  ['registration_bonus', { action: 'update_registration_bonus', kind: 'integer' }],
  ['bot_status', { action: 'update_bot_status', kind: 'on_off' }],
  ['max_bot_amount', { action: 'update_max_bot_amount', kind: 'integer' }],
  ['min_bot_amount', { action: 'update_min_bot_amount', kind: 'integer' }],
  ['streak_bonus_5_days', { action: 'update_streak_bonus_5_days', kind: 'money' }],
  ['streak_bonus_10_days', { action: 'update_streak_bonus_10_days', kind: 'money' }],
  ['streak_bonus_30_days', { action: 'update_streak_bonus_30_days', kind: 'money' }],
]);

const parseConfigValue = (
  field: string,
  kind: ConfigFieldKind,
  raw: unknown
): { ok: true; value: string | number } | { ok: false; error: string; message: string } => {
  if (kind === 'on_off') {
    const value = String(raw ?? '').trim().toLowerCase();
    if (value !== 'on' && value !== 'off') {
      return { ok: false, error: 'invalid_value', message: 'Bot status must be on or off.' };
    }
    return { ok: true, value };
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { ok: false, error: 'invalid_value', message: 'Enter a number that is 0 or more.' };
  }

  if (kind === 'integer') {
    if (!Number.isInteger(numeric)) {
      return { ok: false, error: 'invalid_value', message: 'Enter a whole number.' };
    }
    if (field === 'max_bot_amount' && numeric > MAX_BOT_ACCOUNTS) {
      return {
        ok: false,
        error: 'invalid_value',
        message: `Max bots cannot be more than ${MAX_BOT_ACCOUNTS}.`,
      };
    }
    return { ok: true, value: numeric };
  }

  return { ok: true, value: Math.round(numeric * 100) / 100 };
};

export const updateGameConfig = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const { field, value, actionPassword } = req.body as {
    field?: string;
    value?: number | string;
    actionPassword?: string;
  };

  if (!field || value === undefined || value === null || !actionPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const allowed = allowedFields.get(field);
  if (!allowed) {
    return res.status(400).json({ error: 'invalid_field' });
  }

  const parsed = parseConfigValue(field, allowed.kind, value);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error, message: parsed.message });
  }

  const adminInfo = await fetchAdminActionHash(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO game_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

    if (field === 'min_bot_amount' || field === 'max_bot_amount') {
      const current = await client.query(
        `SELECT min_bot_amount, max_bot_amount FROM game_config WHERE id = 1`
      );
      const minBots =
        field === 'min_bot_amount'
          ? Number(parsed.value)
          : Number(current.rows[0]?.min_bot_amount ?? 0);
      const maxBots =
        field === 'max_bot_amount'
          ? Number(parsed.value)
          : Number(current.rows[0]?.max_bot_amount ?? 0);
      if (minBots > maxBots) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'invalid_value',
          message: 'Min bots cannot be greater than max bots.',
        });
      }
    }

    const updateResult = await client.query(
      `UPDATE game_config SET ${field} = $1, last_updated = NOW() WHERE id = 1 RETURNING ${field}`,
      [parsed.value]
    );

    const details = JSON.stringify({ field, value: parsed.value });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, $2, 1, 'game_config', $3::jsonb, $4, $5)`,
      [admin.adminId, allowed.action, details, req.ip ?? null, req.get('user-agent') ?? null]
    );

    await client.query('COMMIT');
    return res.json({ status: 'ok', value: updateResult.rows[0]?.[field] });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const startGameStatus = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const { actionPassword } = req.body as { actionPassword?: string };
  if (!actionPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const adminInfo = await fetchAdminActionHash(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO game_status (id, status) VALUES (1, 'stopped') ON CONFLICT (id) DO NOTHING`
    );
    const updateResult = await client.query(
      `UPDATE game_status SET status = 'active', updated_at = NOW() WHERE id = 1 AND status = 'stopped' RETURNING status`
    );
    if (!updateResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'already_active' });
    }

    const details = JSON.stringify({ status: 'active' });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'start_game_status', 1, 'game_status', $2::jsonb, $3, $4)`,
      [admin.adminId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );
    await client.query('COMMIT');

    const gameControl = await postGameControlStart();
    if (!gameControl.ok) {
      return res.status(gameControl.status).json({
        error: gameControl.error,
        message: gameControl.message,
      });
    }

    return res.json({ status: 'ok' });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const stopGameStatus = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const { actionPassword } = req.body as { actionPassword?: string };
  if (!actionPassword) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const adminInfo = await fetchAdminActionHash(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO game_status (id, status) VALUES (1, 'stopped') ON CONFLICT (id) DO NOTHING`
    );
    const updateResult = await client.query(
      `UPDATE game_status SET status = 'stopped', updated_at = NOW() WHERE id = 1 AND status = 'active' RETURNING status`
    );
    if (!updateResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'already_stopped' });
    }

    const details = JSON.stringify({ status: 'stopped' });
    await client.query(
      `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
       VALUES ($1, 'stop_game_status', 1, 'game_status', $2::jsonb, $3, $4)`,
      [admin.adminId, details, req.ip ?? null, req.get('user-agent') ?? null]
    );
    await client.query('COMMIT');
    return res.json({ status: 'ok' });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

export const wakeUpGame = async (req: Request, res: Response) => {
  const admin = ensureSuperAdmin(req, res);
  if (!admin) return;

  const result = await postGameControlStart();
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, message: result.message });
  }
  return res.json({ status: 'ok' });
};
