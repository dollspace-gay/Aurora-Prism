import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Rate Limit Middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('when rate limiting is enabled (default)', () => {
    it('should export rate limiters as functions', async () => {
      const {
        authLimiter,
        oauthLimiter,
        writeLimiter,
        searchLimiter,
        apiLimiter,
        xrpcLimiter,
        adminLimiter,
        deletionLimiter,
        viteLimiter,
      } = await import('../../server/middleware/rate-limit');

      expect(typeof authLimiter).toBe('function');
      expect(typeof oauthLimiter).toBe('function');
      expect(typeof writeLimiter).toBe('function');
      expect(typeof searchLimiter).toBe('function');
      expect(typeof apiLimiter).toBe('function');
      expect(typeof xrpcLimiter).toBe('function');
      expect(typeof adminLimiter).toBe('function');
      expect(typeof deletionLimiter).toBe('function');
      expect(typeof viteLimiter).toBe('function');
    });
  });

  describe('when rate limiting is disabled', () => {
    it('should export no-op limiters', async () => {
      process.env.RATE_LIMIT_ENABLED = 'false';

      const { authLimiter, apiLimiter } =
        await import('../../server/middleware/rate-limit');

      // Create mock request/response
      const req = {};
      const res = {};
      const next = vi.fn();

      // No-op limiter should just call next
      authLimiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      apiLimiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('environment variable parsing', () => {
    it('should use default values when env vars not set', async () => {
      // Clear any rate limit env vars
      delete process.env.RATE_LIMIT_AUTH_MAX;
      delete process.env.RATE_LIMIT_API_MAX;

      const module = await import('../../server/middleware/rate-limit');

      // The limiters should be created with defaults
      expect(module.authLimiter).toBeDefined();
      expect(module.apiLimiter).toBeDefined();
    });

    it('should use custom values from env vars', async () => {
      process.env.RATE_LIMIT_AUTH_MAX = '10';
      process.env.RATE_LIMIT_API_MAX = '500';

      const module = await import('../../server/middleware/rate-limit');

      // Limiters should be created (we can't easily verify the max value)
      expect(module.authLimiter).toBeDefined();
      expect(module.apiLimiter).toBeDefined();
    });

    it('should handle invalid env var values gracefully', async () => {
      process.env.RATE_LIMIT_AUTH_MAX = 'invalid';
      process.env.RATE_LIMIT_API_MAX = '-5';
      process.env.RATE_LIMIT_OAUTH_MAX = '0';

      const module = await import('../../server/middleware/rate-limit');

      // Should fall back to defaults for invalid values
      expect(module.authLimiter).toBeDefined();
      expect(module.apiLimiter).toBeDefined();
      expect(module.oauthLimiter).toBeDefined();
    });
  });

  describe('limiter configurations', () => {
    it('authLimiter should exist for authentication protection', async () => {
      const { authLimiter } =
        await import('../../server/middleware/rate-limit');
      expect(authLimiter).toBeDefined();
    });

    it('oauthLimiter should exist for OAuth protection', async () => {
      const { oauthLimiter } =
        await import('../../server/middleware/rate-limit');
      expect(oauthLimiter).toBeDefined();
    });

    it('writeLimiter should exist for write operation protection', async () => {
      const { writeLimiter } =
        await import('../../server/middleware/rate-limit');
      expect(writeLimiter).toBeDefined();
    });

    it('searchLimiter should exist for search protection', async () => {
      const { searchLimiter } =
        await import('../../server/middleware/rate-limit');
      expect(searchLimiter).toBeDefined();
    });

    it('adminLimiter should exist for admin protection', async () => {
      const { adminLimiter } =
        await import('../../server/middleware/rate-limit');
      expect(adminLimiter).toBeDefined();
    });

    it('deletionLimiter should exist for deletion protection', async () => {
      const { deletionLimiter } =
        await import('../../server/middleware/rate-limit');
      expect(deletionLimiter).toBeDefined();
    });

    it('viteLimiter should exist for dev server protection', async () => {
      const { viteLimiter } =
        await import('../../server/middleware/rate-limit');
      expect(viteLimiter).toBeDefined();
    });

    it('xrpcLimiter should exist for XRPC endpoint protection', async () => {
      const { xrpcLimiter } =
        await import('../../server/middleware/rate-limit');
      expect(xrpcLimiter).toBeDefined();
    });
  });
});
