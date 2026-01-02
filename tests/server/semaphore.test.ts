import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Semaphore, acquireWithTimeout } from '../../server/semaphore';

describe('Semaphore', () => {
  describe('constructor', () => {
    it('should create semaphore with specified permits', () => {
      const sem = new Semaphore(5);
      expect(sem.getPermits()).toBe(5);
      expect(sem.getActive()).toBe(0);
      expect(sem.getWaiting()).toBe(0);
    });

    it('should throw error for zero permits', () => {
      expect(() => new Semaphore(0)).toThrow('Semaphore permits must be positive');
    });

    it('should throw error for negative permits', () => {
      expect(() => new Semaphore(-1)).toThrow('Semaphore permits must be positive');
    });
  });

  describe('acquire and release', () => {
    let sem: Semaphore;

    beforeEach(() => {
      sem = new Semaphore(2);
    });

    it('should acquire permit immediately when available', async () => {
      await sem.acquire();
      expect(sem.getActive()).toBe(1);
      expect(sem.getAvailable()).toBe(1);
    });

    it('should acquire multiple permits up to limit', async () => {
      await sem.acquire();
      await sem.acquire();
      expect(sem.getActive()).toBe(2);
      expect(sem.getAvailable()).toBe(0);
    });

    it('should release permit', async () => {
      await sem.acquire();
      expect(sem.getActive()).toBe(1);

      sem.release();
      expect(sem.getActive()).toBe(0);
      expect(sem.getAvailable()).toBe(2);
    });

    it('should throw error when releasing without acquire', () => {
      expect(() => sem.release()).toThrow(
        'Semaphore release() called without acquire()'
      );
    });

    it('should queue acquires when at capacity', async () => {
      await sem.acquire();
      await sem.acquire();

      let acquired = false;
      const acquirePromise = sem.acquire().then(() => {
        acquired = true;
      });

      expect(sem.getWaiting()).toBe(1);
      expect(acquired).toBe(false);

      sem.release();
      await acquirePromise;

      expect(acquired).toBe(true);
      expect(sem.getWaiting()).toBe(0);
    });

    it('should process queue in FIFO order', async () => {
      await sem.acquire();
      await sem.acquire();

      const order: number[] = [];

      const p1 = sem.acquire().then(() => order.push(1));
      const p2 = sem.acquire().then(() => order.push(2));
      const p3 = sem.acquire().then(() => order.push(3));

      expect(sem.getWaiting()).toBe(3);

      sem.release();
      await p1;
      expect(order).toEqual([1]);

      sem.release();
      await p2;
      expect(order).toEqual([1, 2]);

      sem.release();
      await p3;
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('run', () => {
    let sem: Semaphore;

    beforeEach(() => {
      sem = new Semaphore(2);
    });

    it('should execute function with permit and release after', async () => {
      const result = await sem.run(async () => {
        expect(sem.getActive()).toBe(1);
        return 'success';
      });

      expect(result).toBe('success');
      expect(sem.getActive()).toBe(0);
    });

    it('should release permit even on error', async () => {
      await expect(
        sem.run(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(sem.getActive()).toBe(0);
    });

    it('should limit concurrent executions', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const task = async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrent--;
        return maxConcurrent;
      };

      const results = await Promise.all([
        sem.run(task),
        sem.run(task),
        sem.run(task),
        sem.run(task),
      ]);

      expect(maxConcurrent).toBe(2); // Limited to 2 permits
      expect(sem.getActive()).toBe(0);
    });
  });

  describe('getters', () => {
    it('should return correct stats', async () => {
      const sem = new Semaphore(3);

      expect(sem.getPermits()).toBe(3);
      expect(sem.getActive()).toBe(0);
      expect(sem.getWaiting()).toBe(0);
      expect(sem.getAvailable()).toBe(3);
      expect(sem.isAtCapacity()).toBe(false);

      await sem.acquire();
      await sem.acquire();
      await sem.acquire();

      expect(sem.getActive()).toBe(3);
      expect(sem.getAvailable()).toBe(0);
      expect(sem.isAtCapacity()).toBe(true);
    });

    it('should return comprehensive stats object', async () => {
      const sem = new Semaphore(3);
      await sem.acquire();
      await sem.acquire();

      // Add waiter
      sem.acquire(); // Don't await - this will wait

      const stats = sem.getStats();

      expect(stats.permits).toBe(3);
      expect(stats.active).toBe(3); // 2 + 1 from the non-awaited acquire
      expect(stats.waiting).toBe(0); // The third acquire got the permit
      expect(stats.available).toBe(0);
      expect(stats.utilization).toBe(100);

      // Cleanup
      sem.release();
      sem.release();
      sem.release();
    });
  });

  describe('isAtCapacity', () => {
    it('should return false when not at capacity', async () => {
      const sem = new Semaphore(3);
      await sem.acquire();
      expect(sem.isAtCapacity()).toBe(false);
    });

    it('should return true when at capacity', async () => {
      const sem = new Semaphore(2);
      await sem.acquire();
      await sem.acquire();
      expect(sem.isAtCapacity()).toBe(true);
    });
  });
});

describe('acquireWithTimeout', () => {
  it('should acquire when permit is available', async () => {
    const sem = new Semaphore(1);
    const result = await acquireWithTimeout(sem, 100);
    expect(result).toBe(true);
    expect(sem.getActive()).toBe(1);
    sem.release();
  });

  it('should timeout when no permit available', async () => {
    const sem = new Semaphore(1);
    await sem.acquire(); // Take the only permit

    await expect(acquireWithTimeout(sem, 50)).rejects.toThrow(
      'Semaphore acquire timeout after 50ms'
    );

    sem.release();
  });

  it('should acquire if permit becomes available before timeout', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    // Release after 25ms
    setTimeout(() => sem.release(), 25);

    const result = await acquireWithTimeout(sem, 100);
    expect(result).toBe(true);
    expect(sem.getActive()).toBe(1);
    sem.release();
  });

  it('should clear timeout on successful acquire', async () => {
    vi.useFakeTimers();

    const sem = new Semaphore(1);
    const acquirePromise = acquireWithTimeout(sem, 1000);

    await vi.runAllTimersAsync();

    const result = await acquirePromise;
    expect(result).toBe(true);

    vi.useRealTimers();
    sem.release();
  });
});
