import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies with factory functions to avoid hoisting issues
vi.mock('../../server/db', () => {
  return {
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock('../../shared/schema', () => ({
  posts: { uri: 'uri', authorDid: 'authorDid' },
  reposts: { uri: 'uri', userDid: 'userDid' },
  blocks: { blockerDid: 'blockerDid', blockedDid: 'blockedDid' },
  mutes: { muterDid: 'muterDid', mutedDid: 'mutedDid' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
  and: vi.fn((...args) => ({ type: 'and', args })),
  inArray: vi.fn((col, arr) => ({ type: 'inArray', col, arr })),
}));

import { Hydrator } from '../../server/services/hydration';
import type { FeedItem } from '../../server/types/feed';

describe('Hydrator', () => {
  let hydrator: Hydrator;

  beforeEach(() => {
    vi.clearAllMocks();
    hydrator = new Hydrator();
  });

  describe('hydrateFeedItems', () => {
    it('should hydrate empty feed items', async () => {
      const items: FeedItem[] = [];

      const result = await hydrator.hydrateFeedItems(items);

      expect(result).toBeDefined();
      expect(result.posts).toBeDefined();
      expect(result.reposts).toBeDefined();
    });
  });

  describe('hydrateProfileViewersForActors', () => {
    it('should return empty map when no viewerDid provided', async () => {
      const result = await hydrator.hydrateProfileViewersForActors(
        ['did:plc:actor1'],
        undefined
      );

      expect(result).toBeDefined();
      expect(result.size).toBe(0);
    });

    it('should return empty map when empty actorDids', async () => {
      const result = await hydrator.hydrateProfileViewersForActors(
        [],
        'did:plc:viewer'
      );

      expect(result).toBeDefined();
      expect(result.size).toBe(0);
    });
  });
});
