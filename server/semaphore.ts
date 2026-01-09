/**
 * Semaphore for controlling concurrent operations
 * Provides proper async/await support without busy-waiting
 */

export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(permits: number) {
    if (permits <= 0) {
      throw new Error('Semaphore permits must be positive');
    }
    this.permits = permits;
  }

  /**
   * Acquire a permit, waiting if none available
   */
  async acquire(): Promise<void> {
    if (this.active < this.permits) {
      this.active++;
      return Promise.resolve();
    }

    // Wait for a permit to become available
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release a permit, allowing waiting operations to proceed
   */
  release(): void {
    if (this.active <= 0) {
      throw new Error('Semaphore release() called without acquire()');
    }

    this.active--;

    // If there are waiting operations, grant permit to next in queue
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      this.active++;
      resolve!();
    }
  }

  /**
   * Execute a function with semaphore-controlled concurrency
   * Automatically acquires and releases permits
   *
   * @example
   * ```ts
   * const result = await semaphore.run(async () => {
   *   // This code will only run when a permit is available
   *   return await expensiveOperation();
   * });
   * ```
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get current number of active operations
   */
  getActive(): number {
    return this.active;
  }

  /**
   * Get number of operations waiting for permits
   */
  getWaiting(): number {
    return this.queue.length;
  }

  /**
   * Get total permits
   */
  getPermits(): number {
    return this.permits;
  }

  /**
   * Get number of available permits
   */
  getAvailable(): number {
    return Math.max(0, this.permits - this.active);
  }

  /**
   * Check if semaphore is at capacity
   */
  isAtCapacity(): boolean {
    return this.active >= this.permits;
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    permits: number;
    active: number;
    waiting: number;
    available: number;
    utilization: number;
  } {
    return {
      permits: this.permits,
      active: this.active,
      waiting: this.queue.length,
      available: this.getAvailable(),
      utilization: (this.active / this.permits) * 100,
    };
  }
}

/**
 * Try to acquire with timeout
 */
export async function acquireWithTimeout(
  semaphore: Semaphore,
  timeoutMs: number
): Promise<boolean> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  let acquired = false;

  try {
    await Promise.race([
      semaphore.acquire().then(() => {
        acquired = true;
      }),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(new Error(`Semaphore acquire timeout after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
    return acquired;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
