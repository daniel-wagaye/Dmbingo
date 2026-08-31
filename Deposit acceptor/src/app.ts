import express from 'express';
import type { Env } from './env';
import type { Database } from './db';
import type { Metrics } from './metrics';
import type { RegexCache } from './regexCache';
import type { Logger } from './logger';
import { SlidingWindowLimiter, MinIntervalGate } from './rateLimit';
import { KeyLock } from './keyLock';

export type Deps = {
  env: Env;
  db: Database;
  metrics: Metrics;
  regexCache: RegexCache;
  logger: Logger;
  smsLimiter: SlidingWindowLimiter;
  wakeupLimiter: SlidingWindowLimiter;
  wakeupGate: MinIntervalGate;
  keyLock: KeyLock;
  getRuntimeStatus: () => { httpListening: boolean; regexReady: boolean };
};

export function createApp(d: Deps) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '32kb' }));
  app.use(express.text({ type: 'text/plain', limit: '32kb' }));

  app.post('/internal/regex-wakeup', async (req, res) => {
    const ip = req.ip || 'unknown';
    const ct = req.headers['content-type'] || '';
    if (!String(ct).includes('application/json')) {
      res.status(415).json({ error: 'UNSUPPORTED_CONTENT_TYPE' });
      return;
    }
    if (!d.wakeupLimiter.allow(ip)) {
      d.metrics.inc('rate_limit_exceeded_total');
      d.logger.warn({ ip }, 'wakeup rate limit exceeded');
      res.status(429).json({ error: 'RATE_LIMIT' });
      return;
    }
    if (!d.wakeupGate.allow()) {
      d.metrics.inc('rate_limit_exceeded_total');
      d.logger.warn({ ip }, 'wakeup min-interval not satisfied');
      res.status(429).json({ error: 'MIN_INTERVAL' });
      return;
    }
    try {
      const n = await d.regexCache.reloadAll(d.db);
      d.metrics.inc('regex_reload_total');
      d.logger.info({ ip, reloaded: n }, 'regex cache reloaded');
      res.status(200).json({ ok: true, reloaded: n });
    } catch (e) {
      d.logger.error({ ip, err: String(e) }, 'regex reload failed');
      res.status(500).json({ error: 'RELOAD_FAILED', detail: String(e) });
    }
  });

  app.post('/sms/gateway/:token', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (req.params.token !== d.env.DEPOSIT_GATEWAY_PATH_TOKEN) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const headerVal = req.header(d.env.DEPOSIT_GATEWAY_HEADER_NAME);
    if (!headerVal || headerVal !== d.env.DEPOSIT_GATEWAY_PASS_KEY) {
      d.logger.warn({ ip }, 'auth header invalid');
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    if (!d.smsLimiter.allow(ip)) {
      d.metrics.inc('rate_limit_exceeded_total');
      d.logger.warn({ ip }, 'sms rate limit exceeded');
      res.status(429).json({ error: 'RATE_LIMIT' });
      return;
    }
    d.metrics.inc('deposit_requests_total');

    const ct = String(req.headers['content-type'] || '');
    let senderName: string | undefined;
    let sms: string | undefined;
    if (ct.includes('text/plain')) {
      senderName = (req.header('sender_name') || req.header('sender-name') || '') as string;
      sms = typeof req.body === 'string' ? (req.body as string) : undefined;
    } else {
      res.status(415).json({ error: 'UNSUPPORTED_CONTENT_TYPE' });
      return;
    }
    if (!senderName || !sms || typeof senderName !== 'string' || typeof sms !== 'string') {
      res.status(422).json({ parsed: false, reason: 'MISSING_FIELDS' });
      return;
    }

    const configs = d.regexCache.snapshot.get(senderName);
    if (!configs || configs.length === 0) {
      res.status(200).json({ parsed: false, reason: 'NO_CONFIG_FOR_SENDER' });
      return;
    }

    for (const cfg of configs) {
      const txnMatch = sms.match(cfg.txnRe);
      const amtMatch = sms.match(cfg.amountRe);
      if (txnMatch && amtMatch) {
        const txnRaw = (txnMatch[1] ?? txnMatch[0])?.toString() ?? '';
        const amtRaw = (amtMatch[1] ?? amtMatch[0])?.toString() ?? '';
        const txn = txnRaw.trim().toUpperCase();
        const amount = Number((amtRaw || '').replace(/,/g, ''));
        if (!txn || !Number.isFinite(amount) || amount <= 0) {
          continue;
        }
        if (amount < d.env.MIN_DEPOSIT_AMOUNT) {
          d.logger.info({ ip, bank: cfg.bankName, sender: cfg.senderName, txn, amount }, 'deposit ignored below minimum');
          res.status(200).json({ inserted: false, reason: 'AMOUNT_BELOW_MINIMUM' });
          return;
        }
        const bonusMultiplier = 1 + d.env.DEPOSIT_BONUS_PERCENT / 100;
        const finalAmount = Math.round(amount * bonusMultiplier * 100) / 100;
        try {
          const result = await d.keyLock.withKey(txn, async () => {
            const existing = await d.db.findDepositByTxn(txn);
            if (existing != null) {
              return { deposit_id: existing, inserted: false as const };
            }
            return d.db.atomicInsertDeposit(cfg.bankName, finalAmount, txn);
          });
          if (result.inserted) {
            d.metrics.inc('deposit_inserts_total');
            d.logger.info({ ip, bank: cfg.bankName, sender: cfg.senderName, txn, amount, finalAmount, bonusPercent: d.env.DEPOSIT_BONUS_PERCENT }, 'deposit inserted');
            res.status(201).json({ inserted: true, deposit_id: result.deposit_id, bank: cfg.bankName, txn, amount: finalAmount });
            return;
          } else {
            d.metrics.inc('deposit_duplicates_total');
            d.logger.info({ ip, bank: cfg.bankName, sender: cfg.senderName, txn }, 'duplicate deposit');
            res.status(200).json({ inserted: false, reason: 'DUPLICATE', deposit_id: result.deposit_id });
            return;
          }
        } catch (e) {
          const errMsg = (e as any)?.message ?? String(e);
          d.logger.error({ ip, bank: cfg.bankName, sender: cfg.senderName, txn, amount, finalAmount, err: errMsg }, 'insert failed');
          res.status(500).json({ error: 'INSERT_FAILED' });
          return;
        }
      }
    }

    res.status(200).json({ parsed: false, reason: 'NO_REGEX_MATCH' });
  });

  app.get('/health', (_req, res) => {
    const status = d.getRuntimeStatus();
    const ok = status.httpListening && status.regexReady;
    if (!ok) {
      res.status(503).json({ ok: false, ...status });
      return;
    }
    res.status(200).json({ ok: true, ...status });
  });

  return app;
}
