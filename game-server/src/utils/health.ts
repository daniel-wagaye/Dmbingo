import { gameSql } from '../db/drizzle';
import { raiseAlert, resolveAlert } from '../services/alerter';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

let dbStatus: HealthStatus = 'healthy';
let lastDbCheck = 0;
let consecutiveDbFailures = 0;

const DB_CHECK_INTERVAL_MS = 15_000;
const ALERT_KEY = 'db_health';

export function getHealth(): { status: HealthStatus; db: HealthStatus; uptime: number } {
  return {
    status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
    db: dbStatus,
    uptime: Math.floor(process.uptime()),
  };
}

async function checkDb(): Promise<void> {
  try {
    await gameSql`SELECT 1`;
    if (dbStatus !== 'healthy') {
      console.log(`[health] DB connection restored after ${consecutiveDbFailures} failures`);
      resolveAlert(
        ALERT_KEY,
        `Database connection restored after ${consecutiveDbFailures} failed check(s)`
      );
    }
    dbStatus = 'healthy';
    consecutiveDbFailures = 0;
  } catch (err) {
    consecutiveDbFailures++;
    dbStatus = consecutiveDbFailures >= 3 ? 'unhealthy' : 'degraded';
    console.error(`[health] DB check failed (${consecutiveDbFailures}x):`, (err as Error).message);
    if (dbStatus === 'unhealthy') {
      raiseAlert(ALERT_KEY, 'Database health checks failing', {
        consecutive_failures: consecutiveDbFailures,
        error: (err as Error).message,
      });
    }
  }
}

export function startHealthChecks(): void {
  checkDb();
  setInterval(async () => {
    const now = Date.now();
    if (now - lastDbCheck < DB_CHECK_INTERVAL_MS) return;
    lastDbCheck = now;
    await checkDb();
  }, DB_CHECK_INTERVAL_MS);
  console.log(`[health] DB health checks started (every ${DB_CHECK_INTERVAL_MS / 1000}s)`);
}
