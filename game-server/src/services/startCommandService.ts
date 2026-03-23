import { sql } from '../db/drizzle';

let cachedEnabled = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export async function loadStartCommandStatus(): Promise<boolean> {
  try {
    const rows = await sql`SELECT enabled FROM telegram_message WHERE id = 1`;
    cachedEnabled = rows[0]?.enabled === true;
  } catch (err) {
    console.error('[startCommand] Failed to load status from DB:', err);
    cachedEnabled = false;
  }

  // Refresh cache every 30s to pick up admin toggle changes
  if (!refreshTimer) {
    refreshTimer = setInterval(async () => {
      try {
        const rows = await sql`SELECT enabled FROM telegram_message WHERE id = 1`;
        cachedEnabled = rows[0]?.enabled === true;
      } catch {
        // Keep current cached value on failure
      }
    }, 1800000);
  }

  return cachedEnabled;
}

export function isStartCommandEnabled(): boolean {
  return cachedEnabled;
}
