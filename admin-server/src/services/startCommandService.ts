import { queryWithRetry } from '../db/drizzle';

let cachedEnabled: boolean | null = null;

export async function isStartCommandEnabled(): Promise<boolean> {
  if (cachedEnabled !== null) return cachedEnabled;
  const result = await queryWithRetry<{ enabled: boolean }>(
    'SELECT enabled FROM telegram_message WHERE id = 1'
  );
  cachedEnabled = result.rows[0]?.enabled ?? false;
  return cachedEnabled;
}

export async function setStartCommandEnabled(enabled: boolean): Promise<void> {
  await queryWithRetry(
    'UPDATE telegram_message SET enabled = $1 WHERE id = 1',
    [enabled]
  );
  cachedEnabled = enabled;
}

export function getStartCommandCached(): boolean {
  return cachedEnabled ?? false;
}
