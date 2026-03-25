function isRetryableError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  // PG application-level RAISE errors (P0001) are NOT retryable — the query itself is wrong for the current state
  if (e.code === 'P0001') return false;
  // Only retry network/connection errors
  const retryableCodes = new Set([
    '08000', '08001', '08003', '08004', '08006', '08007', '08P01', // connection errors
    '57P01', '57P02', '57P03', // server shutting down
    '53300', // too many connections
    '40001', '40P01', // serialization/deadlock
  ]);
  if (e.code && retryableCodes.has(e.code)) return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('timeout') || msg.includes('econnreset') || msg.includes('etimedout') ||
    msg.includes('connection terminated') || msg.includes('could not connect');
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      console.error(`[${label}] Attempt ${attempt}/${maxRetries} failed:`, err);
      if (!isRetryableError(err) || attempt >= maxRetries) {
        if (!isRetryableError(err)) {
          console.error(`[${label}] Non-retryable error. Giving up immediately.`);
        } else {
          console.error(`[${label}] All ${maxRetries} retries exhausted. Giving up.`);
        }
        throw err;
      }
      const delaySec = attempt * 2;
      console.log(`[${label}] Retrying in ${delaySec}s...`);
      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }
  throw new Error(`[${label}] unreachable`);
}
