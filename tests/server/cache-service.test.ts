import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheService, CacheConfig } from '../../server/services/cache';

// Test only the non-connected behavior to avoid ioredis mocking complexity
describe('CacheService', () => {
  let cacheService: CacheService;
  const defaultConfig: CacheConfig = {
    ttl: 3600,
    keyPrefix: 'test:cache:',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cacheService = new CacheService(defaultConfig);
  });

  describe('constructor', () => {
    it('should create service with default config', () => {
      const service = new CacheService();
      expect(service).toBeDefined();
    });

    it('should create service with custom config', () => {
      const service = new CacheService({ ttl: 1800, keyPrefix: 'custom:' });
      expect(service).toBeDefined();
    });
  });

  describe('getPostAggregations - not initialized', () => {
    it('should return null when not initialized', async () => {
      const result = await cacheService.getPostAggregations(['uri1', 'uri2']);
      expect(result).toBeNull();
    });
  });

  describe('setPostAggregations - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      const aggregations = new Map([['uri1', { replyCount: 5 }]]);
      // Should not throw
      await expect(cacheService.setPostAggregations(aggregations)).resolves.toBeUndefined();
    });
  });

  describe('invalidatePostAggregation - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      await expect(cacheService.invalidatePostAggregation('uri1')).resolves.toBeUndefined();
    });
  });

  describe('getPostViewerStates - not initialized', () => {
    it('should return null when not initialized', async () => {
      const result = await cacheService.getPostViewerStates(['uri1'], 'viewer1');
      expect(result).toBeNull();
    });
  });

  describe('setPostViewerStates - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      const viewerStates = new Map([['uri1', { liked: true }]]);
      await expect(cacheService.setPostViewerStates(viewerStates, 'viewer1')).resolves.toBeUndefined();
    });
  });

  describe('invalidatePostViewerState - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      await expect(cacheService.invalidatePostViewerState('uri1', 'viewer1')).resolves.toBeUndefined();
    });
  });

  describe('getThreadContexts - not initialized', () => {
    it('should return null when not initialized', async () => {
      const result = await cacheService.getThreadContexts(['uri1']);
      expect(result).toBeNull();
    });
  });

  describe('setThreadContexts - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      const contexts = new Map([['uri1', { parentUri: 'at://parent' }]]);
      await expect(cacheService.setThreadContexts(contexts)).resolves.toBeUndefined();
    });
  });

  describe('getLabels - not initialized', () => {
    it('should return null when not initialized', async () => {
      const result = await cacheService.getLabels(['subject1']);
      expect(result).toBeNull();
    });
  });

  describe('setLabels - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      const labels = new Map([['subject1', [{ val: 'spam' }]]]);
      await expect(cacheService.setLabels(labels)).resolves.toBeUndefined();
    });
  });

  describe('getHydrationState - not initialized', () => {
    it('should return null when not initialized', async () => {
      const result = await cacheService.getHydrationState('key1');
      expect(result).toBeNull();
    });
  });

  describe('setHydrationState - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      const state = {
        posts: new Map(),
        actors: new Map(),
        aggregations: new Map(),
        viewerStates: new Map(),
        actorViewerStates: new Map(),
        embeds: new Map(),
        labels: new Map(),
      };
      await expect(cacheService.setHydrationState('key1', state)).resolves.toBeUndefined();
    });
  });

  describe('generic get - not initialized', () => {
    it('should return null when not initialized', async () => {
      const result = await cacheService.get<{ foo: string }>('mykey');
      expect(result).toBeNull();
    });
  });

  describe('generic set - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      await expect(cacheService.set('mykey', { foo: 'bar' })).resolves.toBeUndefined();
    });
  });

  describe('del - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      await expect(cacheService.del('mykey')).resolves.toBeUndefined();
    });
  });

  describe('invalidatePattern - not initialized', () => {
    it('should do nothing when not initialized', async () => {
      await expect(cacheService.invalidatePattern('test:*')).resolves.toBeUndefined();
    });
  });

  describe('disconnect - not initialized', () => {
    it('should handle disconnect when not connected', async () => {
      await expect(cacheService.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('isHealthy - not initialized', () => {
    it('should return false when not initialized', async () => {
      const result = await cacheService.isHealthy();
      expect(result).toBe(false);
    });
  });
});
