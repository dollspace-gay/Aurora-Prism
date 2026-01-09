import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import {
  drizzle as drizzlePg,
  type NodePgDatabase,
} from 'drizzle-orm/node-postgres';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { Pool as PgPool } from 'pg';
import ws from 'ws';
import * as schema from '@shared/schema';
import { registerPool, logAllPoolStatus } from './pool-metrics';

// Track pool instances for cleanup
const poolInstances = new Map<string, NeonPool | PgPool>();

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set. Did you forget to provision a database?'
  );
}

const databaseUrl = process.env.DATABASE_URL;

// Auto-detect: Use standard pg driver for local/Docker PostgreSQL, Neon for cloud
const isNeonDatabase =
  databaseUrl.includes('.neon.tech') ||
  databaseUrl.includes('neon.tech') ||
  databaseUrl.includes('pooler.supabase.com'); // Neon-based services

// Type for database connection
export type DbConnection =
  | NeonDatabase<typeof schema>
  | NodePgDatabase<typeof schema>;

/**
 * Factory function to create a database connection pool
 * @param poolSize - Maximum number of connections in the pool
 * @param label - Label for logging (e.g., "main", "backfill")
 */
export function createDbPool(
  poolSize: number,
  label: string = 'pool'
): DbConnection {
  console.log(
    `[DB] Creating ${label} connection pool: ${poolSize} connections`
  );

  if (isNeonDatabase) {
    // Configure WebSocket for Neon (only needs to be set once, but safe to set multiple times)
    neonConfig.webSocketConstructor = ws;

    const neonPool = new NeonPool({
      // Statement timeout to prevent runaway queries (30 seconds default)
      // Can be overridden per-transaction using SET LOCAL statement_timeout
      options: {
        statement_timeout: parseInt(
          process.env.STATEMENT_TIMEOUT_MS || '30000'
        ),
      },
      connectionString: databaseUrl,
      max: poolSize,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 120000, // 2 minutes - increased for backfill scenarios
    });

    poolInstances.set(label, neonPool);
    registerPool(neonPool, label);
    return drizzle(neonPool, { schema });
  } else {
    const pgPool = new PgPool({
      // Statement timeout to prevent runaway queries
      statement_timeout: parseInt(process.env.STATEMENT_TIMEOUT_MS || '30000'),
      connectionString: databaseUrl,
      max: poolSize,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 120000, // 2 minutes - increased for backfill scenarios
    });

    poolInstances.set(label, pgPool);
    registerPool(pgPool, label);
    return drizzlePg(pgPool, { schema });
  }
}

// Main application pool size
// Optimized defaults based on database type:
//   - Neon serverless: 20 connections (increased from 10 for better concurrency)
//   - Self-hosted PostgreSQL: 40 connections (increased from 20 for better performance)
// Override via DB_POOL_SIZE env var
// Note: Total connections (main + backfill + workers) must stay within database limits:
//   - Neon Free: ~10 connections total
//   - Neon Pro: ~100 connections total
//   - Self-hosted: depends on max_connections setting (typically 100-200)
const DEFAULT_DB_POOL_SIZE = isNeonDatabase ? 20 : 40;
const parsedPoolSize = parseInt(
  process.env.DB_POOL_SIZE || String(DEFAULT_DB_POOL_SIZE),
  10
);
const mainPoolSize =
  Number.isInteger(parsedPoolSize) && parsedPoolSize > 0
    ? parsedPoolSize
    : DEFAULT_DB_POOL_SIZE;

console.log(
  `[DB] Using connection pool size: ${mainPoolSize} (type: ${isNeonDatabase ? 'Neon' : 'PostgreSQL'})`
);

// Create main database connection pool
const db = createDbPool(
  mainPoolSize,
  isNeonDatabase ? 'main (Neon)' : 'main (PostgreSQL)'
);

// For backwards compatibility, export a pool variable (though the actual pool is internal to drizzle)
// This is used by some legacy code that checks pool status
export const pool = db as unknown;

// Export main db connection
export { db };

// Start pool monitoring - log status every 60 seconds
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    logAllPoolStatus();
  }, 60000);

  // Log initial status after 5 seconds
  setTimeout(() => {
    logAllPoolStatus();
  }, 5000);
}
