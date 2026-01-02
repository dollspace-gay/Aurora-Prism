import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before import
vi.mock('../../server/storage', () => ({
  storage: {
    getUserByDid: vi.fn(),
    getUserByHandle: vi.fn(),
  },
}));

vi.mock('../../server/utils/security', () => ({
  isUrlSafeToFetch: vi.fn().mockReturnValue(true),
}));

vi.mock('../../server/services/xrpc/utils/cache', () => ({
  cacheManager: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { resolveDidDocument } from '../../server/services/xrpc/utils/resolvers';

describe('resolvers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveDidDocument', () => {
    it('should return DID document when PLC resolution succeeds', async () => {
      const mockDidDoc = {
        id: 'did:plc:test123',
        alsoKnownAs: ['at://test.bsky.social'],
        service: [
          { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://bsky.social' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDidDoc),
      });

      const result = await resolveDidDocument('did:plc:test123');

      expect(result).toEqual(mockDidDoc);
      expect(mockFetch).toHaveBeenCalledWith('https://plc.directory/did:plc:test123');
    });

    it('should return null when PLC resolution fails with non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await resolveDidDocument('did:plc:nonexistent');

      expect(result).toBeNull();
    });

    it('should return null and log error when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await resolveDidDocument('did:plc:test123');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalled();
    });

    it('should use correct PLC directory URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      await resolveDidDocument('did:plc:abc123');

      expect(mockFetch).toHaveBeenCalledWith('https://plc.directory/did:plc:abc123');
    });

    it('should handle did:web DIDs', async () => {
      const mockDidDoc = {
        id: 'did:web:example.com',
        service: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDidDoc),
      });

      const result = await resolveDidDocument('did:web:example.com');

      expect(result).toEqual(mockDidDoc);
    });
  });
});
