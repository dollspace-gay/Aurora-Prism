import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock storage and pool-metrics before import
vi.mock('../../server/storage', () => ({
  storage: {
    deleteExpiredSessions: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../server/pool-metrics', () => ({
  logAllPoolStatus: vi.fn(),
}));

describe('background-jobs', () => {
  const originalEnv = process.env.NODE_ENV;
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('startBackgroundJobs', () => {
    it('should skip background jobs in test environment', async () => {
      process.env.NODE_ENV = 'test';

      const { startBackgroundJobs } = await import(
        '../../server/background-jobs'
      );

      startBackgroundJobs();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        '[BackgroundJobs] Skipping background jobs in test environment'
      );
    });

    it('should start background jobs in non-test environment', async () => {
      process.env.NODE_ENV = 'development';
      vi.useFakeTimers();

      const { startBackgroundJobs } = await import(
        '../../server/background-jobs'
      );

      startBackgroundJobs();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        '[BackgroundJobs] Starting background jobs...'
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '[BackgroundJobs] Background jobs started successfully'
      );

      vi.useRealTimers();
    });

    it('should log pool status after 5 seconds in non-test environment', async () => {
      process.env.NODE_ENV = 'development';
      vi.useFakeTimers();

      const { logAllPoolStatus } = await import('../../server/pool-metrics');
      const { startBackgroundJobs } = await import(
        '../../server/background-jobs'
      );

      startBackgroundJobs();

      // Advance by 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      expect(logAllPoolStatus).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should run initial cleanup after 30 seconds', async () => {
      process.env.NODE_ENV = 'development';
      vi.useFakeTimers();

      const { storage } = await import('../../server/storage');
      const { startBackgroundJobs } = await import(
        '../../server/background-jobs'
      );

      startBackgroundJobs();

      // Advance by 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      expect(storage.deleteExpiredSessions).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should run hourly session cleanup interval', async () => {
      process.env.NODE_ENV = 'development';
      vi.useFakeTimers();

      const { storage } = await import('../../server/storage');
      const { startBackgroundJobs } = await import(
        '../../server/background-jobs'
      );

      startBackgroundJobs();

      // Clear initial calls
      vi.mocked(storage.deleteExpiredSessions).mockClear();

      // Advance by 1 hour
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(storage.deleteExpiredSessions).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should run pool status logging every 60 seconds', async () => {
      process.env.NODE_ENV = 'development';
      vi.useFakeTimers();

      const { logAllPoolStatus } = await import('../../server/pool-metrics');
      const { startBackgroundJobs } = await import(
        '../../server/background-jobs'
      );

      startBackgroundJobs();

      // Clear initial calls
      vi.mocked(logAllPoolStatus).mockClear();

      // Advance by 60 seconds
      await vi.advanceTimersByTimeAsync(60000);

      expect(logAllPoolStatus).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
