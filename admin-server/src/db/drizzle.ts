import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const caPath = path.resolve(__dirname, '../../certs/prod-ca-2021.crt');
const ca = fs.readFileSync(caPath, 'utf8');

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: {
    ca,
    rejectUnauthorized: true,
  },
});

export const db = drizzle(pool);
