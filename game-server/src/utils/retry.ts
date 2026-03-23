export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delaySec = attempt * 2;
      console.error(`[${label}] Attempt ${attempt}/${maxRetries} failed:`, err);
      if (attempt >= maxRetries) {
        console.error(`[${label}] All ${maxRetries} retries exhausted. Giving up.`);
        throw err;
      }
      console.log(`[${label}] Retrying in ${delaySec}s...`);
      await new Promise(r => setTimeout(r, delaySec * 1000));
    }
  }
  throw new Error(`[${label}] unreachable`);
}
