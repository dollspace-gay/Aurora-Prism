import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheManager } from '../../server/services/xrpc/utils/cache';

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cacheManager = new CacheManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('preferences cache', () => {
    it('should return null for uncached preferences', () => {
      const result = cacheManager.getPreferences('did:plc:unknown');
      expect(result).toBeNull();
    });

    it('should cache and retrieve preferences', () => {
      const prefs = [{ $type: 'app.bsky.actor.defs#savedFeedsPref', saved: [] }];
      cacheManager.setPreferences('did:plc:user1', prefs);

      const result = cacheManager.getPreferences('did:plc:user1');
      expect(result).toEqual(prefs);
    });

    it('should return null for expired preferences', () => {
      const prefs = [{ $type: 'test' }];
      cacheManager.setPreferences('did:plc:user1', prefs);

      // Advance time past TTL (5 minutes)
      vi.advanceTimersByTime(6 * 60 * 1000);

      const result = cacheManager.getPreferences('did:plc:user1');
      expect(result).toBeNull();
    });

    it('should invalidate preferences cache', () => {
      const prefs = [{ $type: 'test' }];
      cacheManager.setPreferences('did:plc:user1', prefs);

      expect(cacheManager.getPreferences('did:plc:user1')).toEqual(prefs);

      cacheManager.invalidatePreferencesCache('did:plc:user1');

      expect(cacheManager.getPreferences('did:plc:user1')).toBeNull();
    });

    it('should not expire preferences before TTL', () => {
      const prefs = [{ $type: 'test' }];
      cacheManager.setPreferences('did:plc:user1', prefs);

      // Advance time but not past TTL
      vi.advanceTimersByTime(4 * 60 * 1000);

      const result = cacheManager.getPreferences('did:plc:user1');
      expect(result).toEqual(prefs);
    });
  });

  describe('handle resolution cache', () => {
    it('should return null for uncached handles', () => {
      const result = cacheManager.getResolvedHandle('unknown.bsky.social');
      expect(result).toBeNull();
    });

    it('should cache and retrieve handle resolutions', () => {
      cacheManager.cacheHandleResolution('test.bsky.social', 'did:plc:test123');

      const result = cacheManager.getResolvedHandle('test.bsky.social');
      expect(result).toBe('did:plc:test123');
    });

    it('should be case-insensitive for handles', () => {
      cacheManager.cacheHandleResolution('Test.Bsky.Social', 'did:plc:test123');

      const result = cacheManager.getResolvedHandle('test.bsky.social');
      expect(result).toBe('did:plc:test123');
    });

    it('should return null for expired handle resolutions', () => {
      cacheManager.cacheHandleResolution('test.bsky.social', 'did:plc:test123');

      // Advance time past TTL (10 minutes)
      vi.advanceTimersByTime(11 * 60 * 1000);

      const result = cacheManager.getResolvedHandle('test.bsky.social');
      expect(result).toBeNull();
    });

    it('should not expire handle resolution before TTL', () => {
      cacheManager.cacheHandleResolution('test.bsky.social', 'did:plc:test123');

      // Advance time but not past TTL
      vi.advanceTimersByTime(9 * 60 * 1000);

      const result = cacheManager.getResolvedHandle('test.bsky.social');
      expect(result).toBe('did:plc:test123');
    });

    it('should log cache hit on successful retrieval', () => {
      cacheManager.cacheHandleResolution('test.bsky.social', 'did:plc:test123');
      cacheManager.getResolvedHandle('test.bsky.social');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[RESOLVE_ACTOR] Cache hit')
      );
    });
  });

  describe('PDS endpoint cache', () => {
    it('should return null for uncached endpoints', () => {
      const result = cacheManager.getPdsEndpoint('did:plc:unknown');
      expect(result).toBeNull();
    });

    it('should cache and retrieve PDS endpoints', () => {
      cacheManager.cachePdsEndpoint('did:plc:user1', 'https://bsky.social');

      const result = cacheManager.getPdsEndpoint('did:plc:user1');
      expect(result).toBe('https://bsky.social');
    });

    it('should return null for expired PDS endpoints', () => {
      cacheManager.cachePdsEndpoint('did:plc:user1', 'https://bsky.social');

      // Advance time past TTL (30 minutes)
      vi.advanceTimersByTime(31 * 60 * 1000);

      const result = cacheManager.getPdsEndpoint('did:plc:user1');
      expect(result).toBeNull();
    });

    it('should not expire PDS endpoint before TTL', () => {
      cacheManager.cachePdsEndpoint('did:plc:user1', 'https://bsky.social');

      // Advance time but not past TTL
      vi.advanceTimersByTime(29 * 60 * 1000);

      const result = cacheManager.getPdsEndpoint('did:plc:user1');
      expect(result).toBe('https://bsky.social');
    });
  });

  describe('automatic cleanup', () => {
    it('should clean expired preferences entries on interval', () => {
      cacheManager.setPreferences('did:plc:user1', [{ test: 1 }]);

      // Advance past preferences TTL
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Trigger cleanup interval (1 minute)
      vi.advanceTimersByTime(60 * 1000);

      // Entry should be cleaned
      expect(cacheManager.getPreferences('did:plc:user1')).toBeNull();
    });

    it('should clean expired handle resolution entries on interval', () => {
      cacheManager.cacheHandleResolution('test.bsky.social', 'did:plc:test123');

      // Advance past handle resolution TTL
      vi.advanceTimersByTime(11 * 60 * 1000);

      // Trigger cleanup interval
      vi.advanceTimersByTime(60 * 1000);

      // Entry should be cleaned (will return null due to expiry check)
      expect(cacheManager.getResolvedHandle('test.bsky.social')).toBeNull();
    });

    it('should clean expired PDS endpoint entries on interval', () => {
      cacheManager.cachePdsEndpoint('did:plc:user1', 'https://bsky.social');

      // Advance past PDS endpoint TTL
      vi.advanceTimersByTime(31 * 60 * 1000);

      // Trigger cleanup interval
      vi.advanceTimersByTime(60 * 1000);

      // Entry should be cleaned
      expect(cacheManager.getPdsEndpoint('did:plc:user1')).toBeNull();
    });
  });

  describe('multiple entries', () => {
    it('should handle multiple preferences entries', () => {
      cacheManager.setPreferences('did:plc:user1', [{ type: 1 }]);
      cacheManager.setPreferences('did:plc:user2', [{ type: 2 }]);
      cacheManager.setPreferences('did:plc:user3', [{ type: 3 }]);

      expect(cacheManager.getPreferences('did:plc:user1')).toEqual([{ type: 1 }]);
      expect(cacheManager.getPreferences('did:plc:user2')).toEqual([{ type: 2 }]);
      expect(cacheManager.getPreferences('did:plc:user3')).toEqual([{ type: 3 }]);
    });

    it('should handle multiple handle resolutions', () => {
      cacheManager.cacheHandleResolution('alice.bsky.social', 'did:plc:alice');
      cacheManager.cacheHandleResolution('bob.bsky.social', 'did:plc:bob');

      expect(cacheManager.getResolvedHandle('alice.bsky.social')).toBe('did:plc:alice');
      expect(cacheManager.getResolvedHandle('bob.bsky.social')).toBe('did:plc:bob');
    });

    it('should handle multiple PDS endpoints', () => {
      cacheManager.cachePdsEndpoint('did:plc:user1', 'https://pds1.example.com');
      cacheManager.cachePdsEndpoint('did:plc:user2', 'https://pds2.example.com');

      expect(cacheManager.getPdsEndpoint('did:plc:user1')).toBe('https://pds1.example.com');
      expect(cacheManager.getPdsEndpoint('did:plc:user2')).toBe('https://pds2.example.com');
    });

    it('should update existing entries', () => {
      cacheManager.setPreferences('did:plc:user1', [{ old: true }]);
      cacheManager.setPreferences('did:plc:user1', [{ new: true }]);

      expect(cacheManager.getPreferences('did:plc:user1')).toEqual([{ new: true }]);
    });
  });
});
