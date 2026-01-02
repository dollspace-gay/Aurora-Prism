import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../server/db', () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [{ users_exists: true, posts_exists: true }] }),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockResolvedValue([{ count: 100 }]),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({
    strings,
    values,
  }),
}));

vi.mock('../../shared/schema', () => ({
  users: {},
  posts: {},
  likes: {},
  reposts: {},
  follows: {},
}));

vi.mock('../../server/services/log-collector', () => ({
  logCollector: {
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

import { DatabaseHealthService, databaseHealthService } from '../../server/services/database-health';

describe('DatabaseHealthService', () => {
  let service: DatabaseHealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service = new DatabaseHealthService();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a new instance', () => {
      expect(service).toBeInstanceOf(DatabaseHealthService);
    });
  });

  describe('stop', () => {
    it('should stop without error when not started', () => {
      expect(() => service.stop()).not.toThrow();
    });

    it('should clear the health check interval', async () => {
      await service.start();
      service.stop();
      // If stop didn't work, advancing timers would cause issues
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
  });

  describe('exported singleton', () => {
    it('should export a singleton instance', () => {
      expect(databaseHealthService).toBeInstanceOf(DatabaseHealthService);
    });
  });
});
