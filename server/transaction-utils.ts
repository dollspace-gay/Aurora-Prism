/**
 * Transaction utilities with timeout and retry logic
 * Handles deadlocks and provides automatic retry with exponential backoff
 */

import type { DbConnection } from './db';

export interface TransactionOptions {
  timeout?: number; // Transaction timeout in milliseconds (default: 10000)
  maxRetries?: number; // Maximum retry attempts for deadlocks (default: 3)
  retryDelay?: number; // Initial retry delay in ms (default: 100)
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * PostgreSQL error codes
 */
export const PG_ERROR_CODES = {
  DEADLOCK: '40P01', // deadlock_detected
  SERIALIZATION_FAILURE: '40001', // serialization_failure
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
} as const;

/**
 * Check if error is retryable (deadlock or serialization failure)
 */
function isRetryableError(error: any): boolean {
  const code = error?.code || error?.constraint || '';
  return (
    code === PG_ERROR_CODES.DEADLOCK ||
    code === PG_ERROR_CODES.SERIALIZATION_FAILURE
  );
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a database transaction with timeout and retry logic
 *
 * @example
 * ```ts
 * await withTransaction(db, async (tx) => {
 *   await tx.insert(posts).values(postData);
 *   await tx.insert(postAggregations).values(aggData);
 * }, { timeout: 5000, maxRetries: 3 });
 * ```
 */
export async function withTransaction<T>(
  db: DbConnection,
  callback: (tx: any) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const {
    timeout = 10000,
    maxRetries = 3,
    retryDelay = 100,
    onRetry,
  } = options;

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      // Execute transaction with timeout
      const result = await Promise.race([
        db.transaction(async (tx) => {
          // Set statement timeout for this transaction
          await tx.execute(`SET LOCAL statement_timeout = ${timeout}`);
          return await callback(tx);
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Transaction timeout after ${timeout}ms`)),
            timeout + 1000 // Give extra second for cleanup
          )
        ),
      ]);

      return result;
    } catch (error: any) {
      lastError = error;

      // Check if error is retryable
      if (isRetryableError(error) && attempt < maxRetries) {
        attempt++;
        const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff

        console.warn(
          `[Transaction] Retrying transaction (attempt ${attempt}/${maxRetries}) after ${delay}ms due to: ${error.code || error.message}`
        );

        if (onRetry) {
          onRetry(attempt, error);
        }

        await sleep(delay);
        continue;
      }

      // Not retryable or max retries exceeded
      throw error;
    }
  }

  throw lastError || new Error('Transaction failed after retries');
}

/**
 * Execute multiple operations in a transaction with automatic retry
 * Provides a simpler API for common use cases
 */
export async function executeInTransaction<T>(
  db: DbConnection,
  operations: Array<(tx: any) => Promise<any>>,
  options?: TransactionOptions
): Promise<T[]> {
  return withTransaction(
    db,
    async (tx) => {
      const results: T[] = [];
      for (const operation of operations) {
        results.push(await operation(tx));
      }
      return results;
    },
    options
  );
}

/**
 * Retry a database operation with exponential backoff
 * For operations that don't need transactions but may encounter deadlocks
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Omit<TransactionOptions, 'timeout'> = {}
): Promise<T> {
  const { maxRetries = 3, retryDelay = 100, onRetry } = options;

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      if (isRetryableError(error) && attempt < maxRetries) {
        attempt++;
        const delay = retryDelay * Math.pow(2, attempt - 1);

        console.warn(
          `[Retry] Retrying operation (attempt ${attempt}/${maxRetries}) after ${delay}ms`
        );

        if (onRetry) {
          onRetry(attempt, error);
        }

        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('Operation failed after retries');
}
