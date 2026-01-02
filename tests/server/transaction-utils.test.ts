import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PG_ERROR_CODES,
  withRetry,
  withTransaction,
  executeInTransaction,
} from '../../server/transaction-utils';

describe('transaction-utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('PG_ERROR_CODES', () => {
    it('should have correct deadlock code', () => {
      expect(PG_ERROR_CODES.DEADLOCK).toBe('40P01');
    });

    it('should have correct serialization failure code', () => {
      expect(PG_ERROR_CODES.SERIALIZATION_FAILURE).toBe('40001');
    });

    it('should have correct unique violation code', () => {
      expect(PG_ERROR_CODES.UNIQUE_VIOLATION).toBe('23505');
    });

    it('should have correct foreign key violation code', () => {
      expect(PG_ERROR_CODES.FOREIGN_KEY_VIOLATION).toBe('23503');
    });
  });

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const promise = withRetry(operation);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on deadlock error', async () => {
      const deadlockError = { code: PG_ERROR_CODES.DEADLOCK, message: 'Deadlock detected' };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(deadlockError)
        .mockResolvedValue('success after retry');

      const promise = withRetry(operation, { maxRetries: 3, retryDelay: 100 });

      // First call fails
      await vi.advanceTimersByTimeAsync(100);
      // Second call succeeds
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe('success after retry');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on serialization failure', async () => {
      const serializationError = { code: PG_ERROR_CODES.SERIALIZATION_FAILURE, message: 'Serialization failure' };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(serializationError)
        .mockResolvedValue('success');

      const promise = withRetry(operation, { maxRetries: 3, retryDelay: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const uniqueViolationError = { code: PG_ERROR_CODES.UNIQUE_VIOLATION, message: 'Unique violation' };
      const operation = vi.fn().mockRejectedValue(uniqueViolationError);

      const promise = withRetry(operation, { maxRetries: 3 });

      await expect(promise).rejects.toMatchObject({ code: '23505' });
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should not retry on generic errors', async () => {
      const genericError = new Error('Generic error');
      const operation = vi.fn().mockRejectedValue(genericError);

      const promise = withRetry(operation, { maxRetries: 3 });

      await expect(promise).rejects.toThrow('Generic error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff', async () => {
      const deadlockError = { code: PG_ERROR_CODES.DEADLOCK };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(deadlockError)
        .mockRejectedValueOnce(deadlockError)
        .mockResolvedValue('success');

      const promise = withRetry(operation, { maxRetries: 3, retryDelay: 100 });

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(0);

      // First retry after 100ms (100 * 2^0)
      await vi.advanceTimersByTimeAsync(100);

      // Second retry after 200ms (100 * 2^1)
      await vi.advanceTimersByTimeAsync(200);

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exceeded', async () => {
      const deadlockError = { code: PG_ERROR_CODES.DEADLOCK, message: 'Deadlock' };
      const operation = vi.fn().mockRejectedValue(deadlockError);

      const promise = withRetry(operation, { maxRetries: 2, retryDelay: 10 });

      // Catch the promise to prevent unhandled rejection warnings
      promise.catch(() => {});

      // Advance through all retries
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toMatchObject({ code: PG_ERROR_CODES.DEADLOCK });
      // Initial attempt + 2 retries = 3 calls
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should call onRetry callback on each retry', async () => {
      const deadlockError = { code: PG_ERROR_CODES.DEADLOCK };
      const operation = vi
        .fn()
        .mockRejectedValueOnce(deadlockError)
        .mockRejectedValueOnce(deadlockError)
        .mockResolvedValue('success');
      const onRetry = vi.fn();

      const promise = withRetry(operation, {
        maxRetries: 3,
        retryDelay: 10,
        onRetry,
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, deadlockError);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, deadlockError);
    });

    it('should use default options when none provided', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const promise = withRetry(operation);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('result');
    });
  });

  describe('withTransaction', () => {
    it('should execute callback within transaction', async () => {
      const mockExecute = vi.fn();
      const mockCallback = vi.fn().mockResolvedValue('transaction result');
      const mockTx = { execute: mockExecute };

      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb) => {
          return await cb(mockTx);
        }),
      };

      const promise = withTransaction(mockDb as any, mockCallback, { timeout: 5000 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('transaction result');
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockCallback).toHaveBeenCalledWith(mockTx);
      expect(mockExecute).toHaveBeenCalledWith('SET LOCAL statement_timeout = 5000');
    });

    it('should retry on deadlock within transaction', async () => {
      const deadlockError = { code: PG_ERROR_CODES.DEADLOCK };
      const mockExecute = vi.fn();
      const mockTx = { execute: mockExecute };

      let callCount = 0;
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb) => {
          callCount++;
          if (callCount === 1) {
            throw deadlockError;
          }
          return await cb(mockTx);
        }),
      };

      const mockCallback = vi.fn().mockResolvedValue('success');

      const promise = withTransaction(mockDb as any, mockCallback, {
        maxRetries: 3,
        retryDelay: 10,
        timeout: 5000,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(mockDb.transaction).toHaveBeenCalledTimes(2);
    });

    it('should throw on timeout', async () => {
      const mockDb = {
        transaction: vi.fn().mockImplementation(async () => {
          // Never resolves - simulates a stuck transaction
          return new Promise(() => {});
        }),
      };

      const mockCallback = vi.fn();

      const promise = withTransaction(mockDb as any, mockCallback, {
        timeout: 100,
        maxRetries: 0,
      });

      // Catch the promise to prevent unhandled rejection warnings
      promise.catch(() => {});

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(1200);

      await expect(promise).rejects.toThrow('Transaction timeout after 100ms');
    });

    it('should call onRetry on transaction retry', async () => {
      const deadlockError = { code: PG_ERROR_CODES.DEADLOCK };
      const mockExecute = vi.fn();
      const mockTx = { execute: mockExecute };

      let callCount = 0;
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb) => {
          callCount++;
          if (callCount === 1) {
            throw deadlockError;
          }
          return await cb(mockTx);
        }),
      };

      const onRetry = vi.fn();
      const mockCallback = vi.fn().mockResolvedValue('success');

      const promise = withTransaction(mockDb as any, mockCallback, {
        maxRetries: 3,
        retryDelay: 10,
        onRetry,
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, deadlockError);
    });

    it('should use default options', async () => {
      const mockExecute = vi.fn();
      const mockTx = { execute: mockExecute };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };
      const mockCallback = vi.fn().mockResolvedValue('result');

      const promise = withTransaction(mockDb as any, mockCallback);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('result');
      // Default timeout is 10000
      expect(mockExecute).toHaveBeenCalledWith('SET LOCAL statement_timeout = 10000');
    });
  });

  describe('executeInTransaction', () => {
    it('should execute all operations in sequence', async () => {
      const mockExecute = vi.fn();
      const mockTx = { execute: mockExecute };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const op1 = vi.fn().mockResolvedValue('result1');
      const op2 = vi.fn().mockResolvedValue('result2');
      const op3 = vi.fn().mockResolvedValue('result3');

      const promise = executeInTransaction(mockDb as any, [op1, op2, op3], { timeout: 5000 });
      await vi.runAllTimersAsync();
      const results = await promise;

      expect(results).toEqual(['result1', 'result2', 'result3']);
      expect(op1).toHaveBeenCalledWith(mockTx);
      expect(op2).toHaveBeenCalledWith(mockTx);
      expect(op3).toHaveBeenCalledWith(mockTx);
    });

    it('should handle empty operations array', async () => {
      const mockExecute = vi.fn();
      const mockTx = { execute: mockExecute };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const promise = executeInTransaction(mockDb as any, []);
      await vi.runAllTimersAsync();
      const results = await promise;

      expect(results).toEqual([]);
    });

    it('should stop on first operation failure', async () => {
      const mockExecute = vi.fn();
      const mockTx = { execute: mockExecute };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      const op1 = vi.fn().mockResolvedValue('result1');
      const op2 = vi.fn().mockRejectedValue(new Error('Operation 2 failed'));
      const op3 = vi.fn().mockResolvedValue('result3');

      const promise = executeInTransaction(mockDb as any, [op1, op2, op3]);

      await expect(promise).rejects.toThrow('Operation 2 failed');
      expect(op1).toHaveBeenCalled();
      expect(op2).toHaveBeenCalled();
      expect(op3).not.toHaveBeenCalled();
    });
  });
});
