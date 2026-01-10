import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../server/storage', () => ({
  storage: {
    getUserSessions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../server/services/auth', () => ({
  authService: {
    extractToken: vi.fn(),
    verifyToken: vi.fn(),
  },
  validateAndRefreshSession: vi.fn(),
}));

import {
  getAuthenticatedDid,
  requireAuthDid,
  getUserSessionForDid,
} from '../../server/services/xrpc/utils/auth-helpers';
import {
  authService,
  validateAndRefreshSession,
} from '../../server/services/auth';
import { storage } from '../../server/storage';

describe('auth-helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.APPVIEW_DID = 'did:plc:appview';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('getAuthenticatedDid', () => {
    it('should return null when no token is present', async () => {
      vi.mocked(authService.extractToken).mockReturnValue(null);

      const mockReq = { path: '/xrpc/app.bsky.feed.getTimeline' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
      expect(console.log).toHaveBeenCalledWith(
        '[AUTH] No token found in request to %s',
        '/xrpc/app.bsky.feed.getTimeline'
      );
    });

    it('should return null when token payload has no DID', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('valid-token');
      vi.mocked(authService.verifyToken).mockResolvedValue({});

      const mockReq = { path: '/xrpc/test' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
    });

    it('should return DID when token is valid', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('valid-token');
      vi.mocked(authService.verifyToken).mockResolvedValue({
        did: 'did:plc:user123',
        aud: 'did:plc:appview',
      });

      const mockReq = {
        path: '/xrpc/app.bsky.feed.getTimeline',
        headers: {},
      } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBe('did:plc:user123');
    });

    it('should return null when APPVIEW_DID is not configured', async () => {
      delete process.env.APPVIEW_DID;
      vi.mocked(authService.extractToken).mockReturnValue('valid-token');
      vi.mocked(authService.verifyToken).mockResolvedValue({
        did: 'did:plc:user123',
      });

      const mockReq = { path: '/xrpc/test' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[AUTH] APPVIEW_DID not configured')
      );
    });

    it('should accept PDS tokens without aud check', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('pds-token');
      vi.mocked(authService.verifyToken).mockResolvedValue({
        did: 'did:plc:user123',
        scope: 'com.atproto.appPassPrivileged',
        aud: 'did:plc:different-pds',
      });

      const mockReq = { path: '/xrpc/test' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBe('did:plc:user123');
    });

    it('should accept com.atproto.access scope tokens', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('access-token');
      vi.mocked(authService.verifyToken).mockResolvedValue({
        did: 'did:plc:user123',
        scope: 'com.atproto.access',
        aud: 'did:plc:some-pds',
      });

      const mockReq = { path: '/xrpc/test' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBe('did:plc:user123');
    });

    it('should reject tokens with mismatched aud for non-PDS tokens', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('token');
      vi.mocked(authService.verifyToken).mockResolvedValue({
        did: 'did:plc:user123',
        aud: 'did:plc:wrong-appview',
      });

      const mockReq = { path: '/xrpc/test' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[AUTH] aud mismatch. expected=%s or %s#bsky_appview got=%s',
        'did:plc:appview',
        'did:plc:appview',
        'did:plc:wrong-appview'
      );
    });

    it('should accept aud with #bsky_appview fragment', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('token');
      vi.mocked(authService.verifyToken).mockResolvedValue({
        did: 'did:plc:user123',
        aud: 'did:plc:appview#bsky_appview',
      });

      const mockReq = { path: '/xrpc/test' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBe('did:plc:user123');
    });

    it('should reject tokens with mismatched lxm', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('token');
      vi.mocked(authService.verifyToken).mockResolvedValue({
        did: 'did:plc:user123',
        aud: 'did:plc:appview',
        lxm: 'different.method',
      });

      const mockReq = { path: '/xrpc/app.bsky.feed.getTimeline' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[AUTH] lxm mismatch. expected=%s got=%s',
        'app.bsky.feed.getTimeline',
        'different.method'
      );
    });

    it('should return null on token verification error', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('bad-token');
      vi.mocked(authService.verifyToken).mockRejectedValue(
        new Error('Invalid token')
      );

      const mockReq = { path: '/xrpc/test' } as any;
      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[AUTH] Token verification failed'),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('requireAuthDid', () => {
    it('should return DID when authenticated', async () => {
      vi.mocked(authService.extractToken).mockReturnValue('valid-token');
      vi.mocked(authService.verifyToken).mockResolvedValue({
        did: 'did:plc:user123',
        aud: 'did:plc:appview',
      });

      const mockReq = { path: '/xrpc/test' } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;

      const result = await requireAuthDid(mockReq, mockRes);

      expect(result).toBe('did:plc:user123');
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', async () => {
      vi.mocked(authService.extractToken).mockReturnValue(null);

      const mockReq = { path: '/xrpc/test' } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;

      const result = await requireAuthDid(mockReq, mockRes);

      expect(result).toBeNull();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'AuthMissing',
        message: 'Authentication Required',
      });
    });
  });

  describe('getUserSessionForDid', () => {
    it('should return null when no sessions exist', async () => {
      vi.mocked(storage.getUserSessions).mockResolvedValue([]);

      const result = await getUserSessionForDid('did:plc:user123');

      expect(result).toBeNull();
    });

    it('should return validated session when one exists', async () => {
      const mockSession = { id: 'session-1', did: 'did:plc:user123' };
      vi.mocked(storage.getUserSessions).mockResolvedValue([mockSession]);
      vi.mocked(validateAndRefreshSession).mockResolvedValue({
        ...mockSession,
        accessToken: 'valid-token',
      });

      const result = await getUserSessionForDid('did:plc:user123');

      expect(result).toEqual({
        ...mockSession,
        accessToken: 'valid-token',
      });
    });

    it('should try multiple sessions until one validates', async () => {
      const sessions = [
        { id: 'session-1', did: 'did:plc:user123' },
        { id: 'session-2', did: 'did:plc:user123' },
      ];
      vi.mocked(storage.getUserSessions).mockResolvedValue(sessions);
      vi.mocked(validateAndRefreshSession)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'session-2', accessToken: 'valid' });

      const result = await getUserSessionForDid('did:plc:user123');

      expect(result).toEqual({ id: 'session-2', accessToken: 'valid' });
      expect(validateAndRefreshSession).toHaveBeenCalledTimes(2);
    });

    it('should return null when all sessions fail validation', async () => {
      const sessions = [
        { id: 'session-1', did: 'did:plc:user123' },
        { id: 'session-2', did: 'did:plc:user123' },
      ];
      vi.mocked(storage.getUserSessions).mockResolvedValue(sessions);
      vi.mocked(validateAndRefreshSession).mockResolvedValue(null);

      const result = await getUserSessionForDid('did:plc:user123');

      expect(result).toBeNull();
    });
  });
});
