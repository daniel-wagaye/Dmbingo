import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { Sql } from 'postgres';
import { config } from '../config';

const queryClient: Sql = postgres(config.databaseUrl, {
  max: 5,
  ssl: 'require',
  idle_timeout: 20,
  connect_timeout: 30,
} as any);
export const db = drizzle(queryClient);
export const sql: Sql = queryClient;