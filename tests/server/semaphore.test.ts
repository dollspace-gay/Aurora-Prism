import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Semaphore, acquireWithTimeout } from '../../server/semaphore';

describe('Semaphore', () => {
  describe('constructor', () => {
    it('should create semaphore with positive permits', () => {
      const sem = new Semaphore(5);
      expect(sem.getPermits()).toBe(5);
      expect(sem.getActive()).toBe(0);
      expect(sem.getAvailable()).toBe(5);
    });

    it('should throw for zero permits', () => {
      expect(() => new Semaphore(0)).toThrow('Semaphore permits must be positive');
    });

    it('should throw for negative permits', () => {
      expect(() => new Semaphore(-1)).toThrow('Semaphore permits must be positive');
    });
  });

  describe('acquire and release', () => {
    it('should acquire permit immediately when available', async () => {
      const sem = new Semaphore(2);

      await sem.acquire();

      expect(sem.getActive()).toBe(1);
      expect(sem.getAvailable()).toBe(1);
    });

    it('should release permit correctly', async () => {
      const sem = new Semaphore(2);

      await sem.acquire();
      expect(sem.getActive()).toBe(1);

      sem.release();
      expect(sem.getActive()).toBe(0);
      expect(sem.getAvailable()).toBe(2);
    });

    it('should throw when releasing without acquire', () => {
      const sem = new Semaphore(2);

      expect(() => sem.release()).toThrow('Semaphore release() called without acquire()');
    });

    it('should queue waiters when at capacity', async () => {
      const sem = new Semaphore(1);

      await sem.acquire();
      expect(sem.getActive()).toBe(1);
      expect(sem.getWaiting()).toBe(0);

      // Start waiting for permit (don't await)
      const waitPromise = sem.acquire();

      // Give microtask queue time to run
      await Promise.resolve();

      expect(sem.getWaiting()).toBe(1);

      // Release to allow waiter to proceed
      sem.release();
      await waitPromise;

      expect(sem.getActive()).toBe(1);
      expect(sem.getWaiting()).toBe(0);
    });

    it('should process waiters in FIFO order', async () => {
      const sem = new Semaphore(1);
      const order: number[] = [];

      await sem.acquire();

      const p1 = sem.acquire().then(() => order.push(1));
      const p2 = sem.acquire().then(() => order.push(2));
      const p3 = sem.acquire().then(() => order.push(3));

      // Release permits one at a time
      sem.release();
      await p1;

      sem.release();
      await p2;

      sem.release();
      await p3;

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('run', () => {
    it('should execute function with automatic acquire/release', async () => {
      const sem = new Semaphore(2);

      const result = await sem.run(async () => {
        expect(sem.getActive()).toBe(1);
        return 'success';
      });

      expect(result).toBe('success');
      expect(sem.getActive()).toBe(0);
    });

    it('should release permit even on error', async () => {
      const sem = new Semaphore(2);

      await expect(
        sem.run(async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      expect(sem.getActive()).toBe(0);
    });

    it('should limit concurrent operations', async () => {
      const sem = new Semaphore(2);
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const operation = async (id: number) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(r => setTimeout(r, 10));
        currentConcurrent--;
        return id;
      };

      const results = await Promise.all([
        sem.run(() => operation(1)),
        sem.run(() => operation(2)),
        sem.run(() => operation(3)),
        sem.run(() => operation(4)),
      ]);

      expect(results).toEqual([1, 2, 3, 4]);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('status methods', () => {
    it('should report correct available permits', async () => {
      const sem = new Semaphore(3);

      expect(sem.getAvailable()).toBe(3);

      await sem.acquire();
      expect(sem.getAvailable()).toBe(2);

      await sem.acquire();
      expect(sem.getAvailable()).toBe(1);

      await sem.acquire();
      expect(sem.getAvailable()).toBe(0);
    });

    it('should report isAtCapacity correctly', async () => {
      const sem = new Semaphore(2);

      expect(sem.isAtCapacity()).toBe(false);

      await sem.acquire();
      expect(sem.isAtCapacity()).toBe(false);

      await sem.acquire();
      expect(sem.isAtCapacity()).toBe(true);

      sem.release();
      expect(sem.isAtCapacity()).toBe(false);
    });

    it('should return accurate stats', async () => {
      const sem = new Semaphore(2);

      await sem.acquire();
      await sem.acquire();
      // Now at capacity (2/2)

      // Start two waiters
      const waitPromise1 = sem.acquire();
      const waitPromise2 = sem.acquire();

      await Promise.resolve();

      const stats = sem.getStats();

      expect(stats.permits).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.waiting).toBe(2);
      expect(stats.available).toBe(0);
      expect(stats.utilization).toBe(100);

      // Cleanup
      sem.release();
      await waitPromise1;
      sem.release();
      await waitPromise2;
    });
  });
});

describe('acquireWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should acquire successfully before timeout', async () => {
    const sem = new Semaphore(1);

    const resultPromise = acquireWithTimeout(sem, 1000);

    // Fast-forward past any potential delays
    await vi.advanceTimersByTimeAsync(100);

    const result = await resultPromise;
    expect(result).toBe(true);
    expect(sem.getActive()).toBe(1);

    sem.release();
  });

  it('should timeout when permit not available', async () => {
    const sem = new Semaphore(1);
    await sem.acquire(); // Take the only permit

    const resultPromise = acquireWithTimeout(sem, 1000);
    // Suppress unhandled rejection warning
    resultPromise.catch(() => {});

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(1100);

    await expect(resultPromise).rejects.toThrow('Semaphore acquire timeout after 1000ms');

    // Release to clean up the waiting acquire in the semaphore queue
    sem.release();
  });

  it('should succeed if permit becomes available before timeout', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const resultPromise = acquireWithTimeout(sem, 1000);

    // Wait a bit then release
    await vi.advanceTimersByTimeAsync(500);
    sem.release();

    const result = await resultPromise;
    expect(result).toBe(true);

    sem.release();
  });
});
