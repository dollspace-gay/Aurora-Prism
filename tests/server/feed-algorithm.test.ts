import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../server/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../shared/schema', () => ({
  postAggregations: { postUri: 'postUri' },
}));

vi.mock('drizzle-orm', () => ({
  inArray: vi.fn(),
}));

vi.mock('../../server/services/cache', () => ({
  cacheService: {
    getPostAggregations: vi.fn().mockResolvedValue(null),
    setPostAggregations: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  FeedAlgorithmService,
  feedAlgorithm,
} from '../../server/services/feed-algorithm';
import type { Post } from '../../shared/schema';

describe('FeedAlgorithmService', () => {
  let service: FeedAlgorithmService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FeedAlgorithmService();
  });

  describe('parseAlgorithm', () => {
    it('should return reverse-chronological for undefined input', () => {
      expect(service.parseAlgorithm(undefined)).toBe('reverse-chronological');
    });

    it('should return reverse-chronological for empty string', () => {
      expect(service.parseAlgorithm('')).toBe('reverse-chronological');
    });

    it('should return engagement for "engagement"', () => {
      expect(service.parseAlgorithm('engagement')).toBe('engagement');
    });

    it('should return engagement for "top"', () => {
      expect(service.parseAlgorithm('top')).toBe('engagement');
    });

    it('should return engagement for "hot"', () => {
      expect(service.parseAlgorithm('hot')).toBe('engagement');
    });

    it('should return discovery for "discovery"', () => {
      expect(service.parseAlgorithm('discovery')).toBe('discovery');
    });

    it('should return discovery for "explore"', () => {
      expect(service.parseAlgorithm('explore')).toBe('discovery');
    });

    it('should be case-insensitive for engagement', () => {
      expect(service.parseAlgorithm('ENGAGEMENT')).toBe('engagement');
      expect(service.parseAlgorithm('Engagement')).toBe('engagement');
      expect(service.parseAlgorithm('TOP')).toBe('engagement');
      expect(service.parseAlgorithm('Hot')).toBe('engagement');
    });

    it('should be case-insensitive for discovery', () => {
      expect(service.parseAlgorithm('DISCOVERY')).toBe('discovery');
      expect(service.parseAlgorithm('Discovery')).toBe('discovery');
      expect(service.parseAlgorithm('EXPLORE')).toBe('discovery');
    });

    it('should return reverse-chronological for unknown algorithm', () => {
      expect(service.parseAlgorithm('unknown')).toBe('reverse-chronological');
      expect(service.parseAlgorithm('random')).toBe('reverse-chronological');
      expect(service.parseAlgorithm('latest')).toBe('reverse-chronological');
    });
  });

  describe('enrichPostsWithEngagement', () => {
    it('should return empty array for empty input', async () => {
      const result = await service.enrichPostsWithEngagement([]);
      expect(result).toEqual([]);
    });

    it('should enrich posts with engagement data', async () => {
      const mockPosts: Post[] = [
        {
          uri: 'at://post1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Hello world',
          indexedAt: new Date(),
          createdAt: new Date(),
        } as Post,
      ];

      const result = await service.enrichPostsWithEngagement(mockPosts);

      expect(result).toHaveLength(1);
      expect(result[0].uri).toBe('at://post1');
      expect(result[0].likeCount).toBeDefined();
      expect(result[0].repostCount).toBeDefined();
      expect(result[0].engagementScore).toBeDefined();
    });

    it('should default counts to 0 when no aggregations found', async () => {
      const mockPosts: Post[] = [
        {
          uri: 'at://post1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Hello world',
          indexedAt: new Date(),
          createdAt: new Date(),
        } as Post,
      ];

      const result = await service.enrichPostsWithEngagement(mockPosts);

      expect(result[0].likeCount).toBe(0);
      expect(result[0].repostCount).toBe(0);
    });
  });

  describe('applyAlgorithm', () => {
    const createPost = (uri: string, hoursAgo: number): Post =>
      ({
        uri,
        cid: `cid-${uri}`,
        authorDid: `did:plc:author-${uri}`,
        text: `Post ${uri}`,
        indexedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
      }) as Post;

    it('should use reverse-chronological by default', async () => {
      const posts = [
        createPost('post1', 2),
        createPost('post2', 1),
        createPost('post3', 3),
      ];

      const result = await service.applyAlgorithm(posts);

      // Should be sorted newest first
      expect(result[0].uri).toBe('post2');
      expect(result[1].uri).toBe('post1');
      expect(result[2].uri).toBe('post3');
    });

    it('should handle reverse-chronological algorithm explicitly', async () => {
      const posts = [createPost('old', 5), createPost('new', 1)];

      const result = await service.applyAlgorithm(
        posts,
        'reverse-chronological'
      );

      expect(result[0].uri).toBe('new');
      expect(result[1].uri).toBe('old');
    });

    it('should handle engagement algorithm', async () => {
      const posts = [createPost('post1', 1), createPost('post2', 2)];

      const result = await service.applyAlgorithm(posts, 'engagement');

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('engagementScore');
    });

    it('should handle discovery algorithm', async () => {
      const posts = [
        createPost('post1', 1),
        createPost('post2', 48), // Old post
      ];

      const result = await service.applyAlgorithm(posts, 'discovery');

      expect(result).toHaveLength(2);
    });

    it('should default to reverse-chronological for unknown algorithm', async () => {
      const posts = [createPost('post1', 2), createPost('post2', 1)];

      // TypeScript won't allow this, but test runtime behavior
      const result = await service.applyAlgorithm(posts, 'unknown' as any);

      expect(result[0].uri).toBe('post2');
    });
  });

  describe('exported singleton', () => {
    it('should export a singleton instance', () => {
      expect(feedAlgorithm).toBeInstanceOf(FeedAlgorithmService);
    });
  });
});
