import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { csrfProtection } from '../../server/middleware/csrf';

describe('CSRFProtection', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateToken', () => {
    it('should generate a 64-character hex token', () => {
      const token = csrfProtection.generateToken();
      expect(token.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it('should generate unique tokens', () => {
      const token1 = csrfProtection.generateToken();
      const token2 = csrfProtection.generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('signToken', () => {
    it('should produce consistent signatures for same token', () => {
      const token = 'test-token';
      const sig1 = csrfProtection.signToken(token);
      const sig2 = csrfProtection.signToken(token);
      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different tokens', () => {
      const sig1 = csrfProtection.signToken('token1');
      const sig2 = csrfProtection.signToken('token2');
      expect(sig1).not.toBe(sig2);
    });

    it('should return a hex string', () => {
      const sig = csrfProtection.signToken('test');
      expect(/^[0-9a-f]+$/.test(sig)).toBe(true);
    });
  });

  describe('verifyToken', () => {
    it('should return true for valid token-signature pair', () => {
      const token = csrfProtection.generateToken();
      const signature = csrfProtection.signToken(token);
      expect(csrfProtection.verifyToken(token, signature)).toBe(true);
    });

    it('should return false for invalid signature', () => {
      const token = csrfProtection.generateToken();
      const wrongSig = csrfProtection.signToken('wrong-token');
      expect(csrfProtection.verifyToken(token, wrongSig)).toBe(false);
    });

    it('should return false for mismatched signature length', () => {
      const token = csrfProtection.generateToken();
      expect(csrfProtection.verifyToken(token, 'short')).toBe(false);
    });
  });

  describe('setToken middleware', () => {
    it('should set cookies when no csrf_token cookie exists', () => {
      const req = { cookies: {} } as any;
      const res = { cookie: vi.fn() } as any;
      const next = vi.fn();

      csrfProtection.setToken(req, res, next);

      expect(res.cookie).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalled();
    });

    it('should not set cookies when csrf_token cookie exists', () => {
      const req = { cookies: { csrf_token: 'existing-token' } } as any;
      const res = { cookie: vi.fn() } as any;
      const next = vi.fn();

      csrfProtection.setToken(req, res, next);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('validateToken middleware', () => {
    it('should skip validation for GET requests', () => {
      const req = { method: 'GET' } as any;
      const res = {} as any;
      const next = vi.fn();

      csrfProtection.validateToken(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should skip validation for HEAD requests', () => {
      const req = { method: 'HEAD' } as any;
      const next = vi.fn();

      csrfProtection.validateToken(req, {} as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('should return 403 when token is missing', () => {
      const req = {
        method: 'POST',
        path: '/test',
        headers: {},
        body: {},
        cookies: {},
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const next = vi.fn();

      csrfProtection.validateToken(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next for valid token', () => {
      const token = csrfProtection.generateToken();
      const signature = csrfProtection.signToken(token);
      const req = {
        method: 'POST',
        path: '/test',
        headers: { 'x-csrf-token': token },
        cookies: { csrf_token: token, csrf_signature: signature },
      } as any;
      const next = vi.fn();

      csrfProtection.validateToken(req, {} as any, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('getTokenValue', () => {
    it('should return token from cookies', () => {
      const req = { cookies: { csrf_token: 'my-token' } } as any;
      expect(csrfProtection.getTokenValue(req)).toBe('my-token');
    });

    it('should return null when no token cookie', () => {
      const req = { cookies: {} } as any;
      expect(csrfProtection.getTokenValue(req)).toBeNull();
    });
  });
});
