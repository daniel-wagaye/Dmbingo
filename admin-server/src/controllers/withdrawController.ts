import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { queryWithRetry, withTransactionRetry } from '../db/drizzle';
import { sendUserTelegramText, type InlineKeyboard } from '../services/telegramNotifier';
import { triggerWithdrawalUpdatedSync } from '../support';

type AdminPayload = { adminId: number; role: 'super_admin' | 'withdrawal_admin' };

const PAGE_SIZE = 200;

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const buildApprovedInlineKeyboard = (): InlineKeyboard => {
  return {
    inline_keyboard: [[{ text: 'ጨዋታ ይቀጥሉ 🎱', url: 'https://t.me/dmbingobot/startapp' }]],
  };
};

const buildDeclinedInlineKeyboard = (): InlineKeyboard => {
  return {
    inline_keyboard: [[{ text: 'ድጋፍ ያግኙ', url: 'https://t.me/Dmbingo_support' }]],
  };
};

const sendTelegramMessage = async (
  telegramId: number,
  message: string,
  replyMarkup?: InlineKeyboard
) => {
  await sendUserTelegramText(telegramId, message, replyMarkup);
};

const getAdminInfo = async (adminId: number) => {
  const adminResult = await queryWithRetry(
    `SELECT admin_id, first_name, action_password_hash FROM admins WHERE admin_id = $1`,
    [adminId]
  );
  return adminResult.rows[0] as
    | { admin_id: number; first_name: string | null; action_password_hash: string }
    | undefined;
};

export const listWithdrawals = async (req: Request, res: Response) => {
  const page = Math.max(Number.parseInt((req.query.page as string) ?? '1', 10), 1);
  const statusParam = (req.query.status as string | undefined)?.toLowerCase();
  const isPending = statusParam === 'pending';
  const search = (req.query.search as string | undefined)?.trim();
  const startDate = (req.query.startDate as string | undefined)?.trim();
  const endDate = (req.query.endDate as string | undefined)?.trim();

  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];

  if (isPending) {
    clauses.push(`w.status = 'pending'`);
  } else {
    clauses.push(`w.status IN ('approved', 'declined')`);
  }

  if (search) {
    params.push(`%${search}%`);
    clauses.push(
      `(CAST(w.telegram_id AS TEXT) ILIKE $${params.length} OR CAST(w.amount AS TEXT) ILIKE $${params.length} OR w.bank ILIKE $${params.length} OR w.account_num ILIKE $${params.length} OR u.first_name ILIKE $${params.length})`
    );
  }
  if (startDate) {
    params.push(new Date(startDate));
    clauses.push(`w.created_at >= $${params.length}`);
  }
  if (endDate) {
    params.push(new Date(endDate));
    clauses.push(`w.created_at <= $${params.length}`);
  }

  const whereClause = `WHERE ${clauses.join(' AND ')}`;
  const offset = (page - 1) * PAGE_SIZE;

  const countResult = await queryWithRetry(
    `SELECT COUNT(*)::int AS total FROM withdrawals_request w LEFT JOIN users u ON u.telegram_id = w.telegram_id ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  params.push(PAGE_SIZE, offset);
  const dataResult = await queryWithRetry(
    `
      SELECT
        w.withdrawal_id,
        w.telegram_id,
        u.first_name,
        w.amount,
        w.bank,
        w.account_holder_name AS account_holder,
        w.account_num,
        w.status,
        COALESCE(
          NULLIF(w.declined_reason, ''),
          (
            SELECT
              CASE
                WHEN COALESCE(
                  NULLIF(a.details->>'reasonNote', ''),
                  NULLIF(a.details->>'reason_note', ''),
                  NULLIF(a.details->>'note', '')
                ) IS NOT NULL
                  THEN CONCAT(
                    COALESCE(
                      NULLIF(a.details->>'reason', ''),
                      NULLIF(a.details->>'declined_reason', ''),
                      'declined'
                    ),
                    ': ',
                    COALESCE(
                      NULLIF(a.details->>'reasonNote', ''),
                      NULLIF(a.details->>'reason_note', ''),
                      NULLIF(a.details->>'note', '')
                    )
                  )
                ELSE COALESCE(
                  NULLIF(a.details->>'reason', ''),
                  NULLIF(a.details->>'declined_reason', '')
                )
              END
            FROM admin_actions a
            WHERE a.target_id = w.withdrawal_id
              AND (
                a.action = 'decline_withdrawal'
                OR a.action = 'withdrawal_declined'
                OR a.action ILIKE '%declin%withdraw%'
              )
              AND (a.target_type IS NULL OR a.target_type = 'withdrawal' OR a.target_type ILIKE '%withdraw%')
            ORDER BY a.created_at DESC
            LIMIT 1
          )
        ) AS declined_reason,
        w.created_at,
        w.processed_at
      FROM withdrawals_request w
      LEFT JOIN users u ON u.telegram_id = w.telegram_id
      ${whereClause}
      ORDER BY w.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );

  return res.json({
    data: dataResult.rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
};

export const approveWithdrawal = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { withdrawalId, actionPassword, adminTxNumber } = req.body as {
    withdrawalId?: number;
    actionPassword?: string;
    adminTxNumber?: string;
  };

  if (!withdrawalId || !actionPassword || !adminTxNumber?.trim()) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (adminTxNumber.trim().length < 9 || adminTxNumber.trim().length > 21) {
    return res.status(400).json({ error: 'invalid_tx_number' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  try {
    const txResult = await withTransactionRetry(async (client) => {
      const updateResult = await client.query(
      `UPDATE withdrawals_request
       SET status = 'approved',
           admin_tx_number = $1,
           admin_first_name = $2,
           processed_at = NOW()
       WHERE withdrawal_id = $3 AND status = 'pending'
       RETURNING telegram_id, amount, bank`,
      [adminTxNumber.trim(), adminInfo.first_name ?? '', withdrawalId]
    );
      if (!updateResult.rows.length) {
        return null;
      }

      const row = updateResult.rows[0] as { telegram_id: number; amount: string; bank: string };
      const details = JSON.stringify({ adminTxNumber: adminTxNumber.trim(), withdrawalId });
      await client.query(
        `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
         VALUES ($1, 'approve_withdrawal', $2, 'withdrawal', $3::jsonb, $4, $5)`,
        [admin.adminId, withdrawalId, details, req.ip ?? null, req.get('user-agent') ?? null]
      );

      return row;
    });
    if (!txResult) {
      return res.status(404).json({ error: 'withdrawal_not_found' });
    }
    triggerWithdrawalUpdatedSync();

    await sendTelegramMessage(
      txResult.telegram_id,
      `✅ የ${escapeHtml(txResult.amount)} ETB ገንዘብ ማውጣት ጥያቄዎ ወደ ${escapeHtml(txResult.bank)} አካውንትዎ በተሳካ ሁኔታ ተልኳል።\nየግብይት ቁጥር: ${escapeHtml(adminTxNumber.trim())}`,
      buildApprovedInlineKeyboard()
    );

    return res.json({ status: 'ok' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  }
};

export const declineWithdrawal = async (req: Request, res: Response) => {
  const admin = (req as Request & { admin?: AdminPayload }).admin;
  if (!admin) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { withdrawalId, actionPassword, reason, reasonNote } = req.body as {
    withdrawalId?: number;
    actionPassword?: string;
    reason?: 'incorrect' | 'bank';
    reasonNote?: string;
  };

  if (!withdrawalId || !actionPassword || !reason) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (reason !== 'incorrect' && reason !== 'bank') {
    return res.status(400).json({ error: 'invalid_reason' });
  }
  const normalizedReasonNote = (reasonNote ?? '').trim();
  if (normalizedReasonNote.length > 200) {
    return res.status(400).json({ error: 'reason_note_too_long' });
  }

  const adminInfo = await getAdminInfo(admin.adminId);
  if (!adminInfo) {
    return res.status(404).json({ error: 'admin_not_found' });
  }
  const passwordOk = await argon2.verify(adminInfo.action_password_hash, actionPassword);
  if (!passwordOk) {
    return res.status(401).json({ error: 'invalid_action_password' });
  }

  try {
    const txResult = await withTransactionRetry(async (client) => {
      const requestResult = await client.query(
        `SELECT telegram_id, amount FROM withdrawals_request WHERE withdrawal_id = $1 AND status = 'pending'`,
        [withdrawalId]
      );
      if (!requestResult.rows.length) {
        return null;
      }

      const row = requestResult.rows[0] as { telegram_id: number; amount: string };
      await client.query(
        `UPDATE users SET withdrawal_wallet = withdrawal_wallet + $1 WHERE telegram_id = $2`,
        [row.amount, row.telegram_id]
      );

      await client.query(
        `UPDATE withdrawals_request
         SET status = 'declined',
             declined_reason = $1,
             admin_first_name = $2,
             processed_at = NOW()
         WHERE withdrawal_id = $3`,
        [normalizedReasonNote ? `${reason}: ${normalizedReasonNote}` : reason, adminInfo.first_name ?? '', withdrawalId]
      );

      const details = JSON.stringify({ reason, reasonNote: normalizedReasonNote, withdrawalId });
      await client.query(
        `INSERT INTO admin_actions (admin_id, action, target_id, target_type, details, ip_address, user_agent)
         VALUES ($1, 'decline_withdrawal', $2, 'withdrawal', $3::jsonb, $4, $5)`,
        [admin.adminId, withdrawalId, details, req.ip ?? null, req.get('user-agent') ?? null]
      );
      return row;
    });
    if (!txResult) {
      return res.status(404).json({ error: 'withdrawal_not_found' });
    }
    triggerWithdrawalUpdatedSync();

    const additionalInfoQuote = normalizedReasonNote
      ? `\n\n${escapeHtml(normalizedReasonNote)}`
      : '';
    const message =
      reason === 'bank'
        ? `🙏 እባክዎ ሌላ ባንክ ይምረጡ።\nለተፈጠረው እንከን ይቅርታ።${additionalInfoQuote}`
        : `❌ ጥያቄዎ በተሳሳተ መረጃ ምክንያት ተሰርዟል።\nእባክዎ ትክክለኛ መረጃ በመጠቀም እንደገና ያመልክቱ።${additionalInfoQuote}`;
    await sendTelegramMessage(txResult.telegram_id, message, buildDeclinedInlineKeyboard());

    return res.json({ status: 'ok' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    return res.status(500).json({ error: message });
  }
};
