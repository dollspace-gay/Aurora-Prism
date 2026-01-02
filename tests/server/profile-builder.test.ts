import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../server/storage', () => ({
  storage: {
    getUserByDid: vi.fn(),
    getUserByHandle: vi.fn(),
    resolveHandleToDid: vi.fn(),
  },
}));

vi.mock('../../server/services/xrpc/utils/serializers', () => ({
  transformBlobToCdnUrl: vi.fn((blobCid, userDid, format) => {
    if (!blobCid) return '';
    return `https://cdn.example.com/${format}/${userDid}/${blobCid}`;
  }),
}));

import { getAuthenticatedDid } from '../../server/services/xrpc/utils/profile-builder';

describe('profile-builder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthenticatedDid', () => {
    it('should return DID from req.auth.did if present', async () => {
      const mockReq = {
        auth: {
          did: 'did:plc:authenticated-user',
        },
      } as any;

      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBe('did:plc:authenticated-user');
    });

    it('should return DID from session if auth.did not present', async () => {
      const mockReq = {
        session: {
          did: 'did:plc:session-user',
        },
      } as any;

      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBe('did:plc:session-user');
    });

    it('should return null when no auth or session present', async () => {
      const mockReq = {} as any;

      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
    });

    it('should prefer auth.did over session.did', async () => {
      const mockReq = {
        auth: {
          did: 'did:plc:auth-user',
        },
        session: {
          did: 'did:plc:session-user',
        },
      } as any;

      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBe('did:plc:auth-user');
    });

    it('should return null when auth exists but did is undefined', async () => {
      const mockReq = {
        auth: {},
      } as any;

      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
    });

    it('should return null when session exists but did is undefined', async () => {
      const mockReq = {
        session: {},
      } as any;

      const result = await getAuthenticatedDid(mockReq);

      expect(result).toBeNull();
    });
  });
});
