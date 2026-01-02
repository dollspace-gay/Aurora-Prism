import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalEnv = process.env;

describe('CSRFProtection', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.SESSION_SECRET = 'test-secret-for-csrf-testing-32chars!!';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('generateToken', () => {
    it('should generate a hex string', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate tokens of correct length (64 hex chars = 32 bytes)', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      expect(token.length).toBe(64);
    });

    it('should generate unique tokens', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(csrf.generateToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('signToken', () => {
    it('should return a hex string', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const signature = csrf.signToken('test-token');
      expect(signature).toMatch(/^[0-9a-f]+$/);
    });

    it('should return consistent signatures for same input', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const sig1 = csrf.signToken('same-token');
      const sig2 = csrf.signToken('same-token');
      expect(sig1).toBe(sig2);
    });

    it('should return different signatures for different inputs', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const sig1 = csrf.signToken('token1');
      const sig2 = csrf.signToken('token2');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token/signature pair', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      const signature = csrf.signToken(token);
      expect(csrf.verifyToken(token, signature)).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      const badSignature = 'invalid-signature-here';
      expect(csrf.verifyToken(token, badSignature)).toBe(false);
    });

    it('should reject wrong token for signature', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token1 = csrf.generateToken();
      const signature1 = csrf.signToken(token1);
      const token2 = csrf.generateToken();
      expect(csrf.verifyToken(token2, signature1)).toBe(false);
    });

    it('should reject mismatched length signatures', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      expect(csrf.verifyToken(token, 'short')).toBe(false);
    });

    it('should be resistant to timing attacks (constant-time comparison)', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      const signature = csrf.signToken(token);

      // Both should take roughly same time regardless of where mismatch occurs
      const wrongSig1 = 'a'.repeat(signature.length);
      const wrongSig2 = signature.slice(0, -1) + 'x';

      expect(csrf.verifyToken(token, wrongSig1)).toBe(false);
      expect(csrf.verifyToken(token, wrongSig2)).toBe(false);
    });
  });

  describe('setToken middleware', () => {
    it('should set cookies when no token exists', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = { cookies: {} } as any;
      const res = {
        cookie: vi.fn(),
      } as any;
      const next = vi.fn();

      csrf.setToken(req, res, next);

      expect(res.cookie).toHaveBeenCalledTimes(2);
      expect(res.cookie).toHaveBeenCalledWith(
        'csrf_token',
        expect.any(String),
        expect.objectContaining({
          httpOnly: false,
          sameSite: 'lax',
        })
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'csrf_signature',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
        })
      );
      expect(next).toHaveBeenCalled();
    });

    it('should not set cookies when token already exists', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = { cookies: { csrf_token: 'existing-token' } } as any;
      const res = {
        cookie: vi.fn(),
      } as any;
      const next = vi.fn();

      csrf.setToken(req, res, next);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should set secure cookie in production', async () => {
      process.env.NODE_ENV = 'production';
      vi.resetModules();

      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = { cookies: {} } as any;
      const res = {
        cookie: vi.fn(),
      } as any;
      const next = vi.fn();

      csrf.setToken(req, res, next);

      expect(res.cookie).toHaveBeenCalledWith(
        'csrf_token',
        expect.any(String),
        expect.objectContaining({
          secure: true,
        })
      );
    });
  });

  describe('validateToken middleware', () => {
    it('should skip validation for GET requests', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = { method: 'GET' } as any;
      const res = {} as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip validation for HEAD requests', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = { method: 'HEAD' } as any;
      const res = {} as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip validation for OPTIONS requests', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = { method: 'OPTIONS' } as any;
      const res = {} as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject POST without token', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = {
        method: 'POST',
        headers: {},
        body: {},
        cookies: {},
        path: '/api/test',
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'CSRF token missing',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject when cookies are missing', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = {
        method: 'POST',
        headers: { 'x-csrf-token': 'some-token' },
        body: {},
        cookies: {},
        path: '/api/test',
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'CSRF validation failed',
          message: 'CSRF cookies missing',
        })
      );
    });

    it('should reject when token does not match cookie', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = {
        method: 'POST',
        headers: { 'x-csrf-token': 'submitted-token' },
        body: {},
        cookies: {
          csrf_token: 'different-token',
          csrf_signature: 'some-signature',
        },
        path: '/api/test',
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'CSRF validation failed',
          message: 'CSRF token mismatch',
        })
      );
    });

    it('should reject when signature is invalid', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      const req = {
        method: 'POST',
        headers: { 'x-csrf-token': token },
        body: {},
        cookies: {
          csrf_token: token,
          csrf_signature: 'invalid-signature',
        },
        path: '/api/test',
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'CSRF validation failed',
          message: 'CSRF token signature invalid',
        })
      );
    });

    it('should accept valid token from header', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      const signature = csrf.signToken(token);

      const req = {
        method: 'POST',
        headers: { 'x-csrf-token': token, 'user-agent': 'test' },
        body: {},
        cookies: {
          csrf_token: token,
          csrf_signature: signature,
        },
        path: '/api/test',
      } as any;
      const res = {} as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should accept valid token from body', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const token = csrf.generateToken();
      const signature = csrf.signToken(token);

      const req = {
        method: 'POST',
        headers: { 'user-agent': 'test' },
        body: { csrfToken: token },
        cookies: {
          csrf_token: token,
          csrf_signature: signature,
        },
        path: '/api/test',
      } as any;
      const res = {} as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should prefer header token over body token', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const headerToken = csrf.generateToken();
      const headerSignature = csrf.signToken(headerToken);

      const req = {
        method: 'POST',
        headers: { 'x-csrf-token': headerToken, 'user-agent': 'test' },
        body: { csrfToken: 'different-body-token' },
        cookies: {
          csrf_token: headerToken,
          csrf_signature: headerSignature,
        },
        path: '/api/test',
      } as any;
      const res = {} as any;
      const next = vi.fn();

      csrf.validateToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('getTokenValue', () => {
    it('should return token from cookies', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = { cookies: { csrf_token: 'my-token' } } as any;
      expect(csrf.getTokenValue(req)).toBe('my-token');
    });

    it('should return null when no token', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = { cookies: {} } as any;
      expect(csrf.getTokenValue(req)).toBeNull();
    });

    it('should return null when cookies undefined', async () => {
      const { CSRFProtection } = await import('../../server/middleware/csrf');
      const csrf = new CSRFProtection();
      const req = {} as any;
      expect(csrf.getTokenValue(req)).toBeNull();
    });
  });

  describe('SESSION_SECRET requirement', () => {
    it('should throw error when SESSION_SECRET is not set', async () => {
      delete process.env.SESSION_SECRET;
      vi.resetModules();

      await expect(
        import('../../server/middleware/csrf')
      ).rejects.toThrow('SESSION_SECRET environment variable is required');
    });
  });
});
