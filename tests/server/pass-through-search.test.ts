import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  PostSearchResult,
  ActorSearchResult,
} from '../../server/services/search';

// Create shared mock functions
const mockSearchPosts = vi.fn();
const mockSearchActors = vi.fn();
const mockSearchStarterPacks = vi.fn();
const mockGetSession = vi.fn();
const mockGetListBlocksForUsers = vi.fn();
const mockGetListMutesForUsers = vi.fn();

// Mock the storage module to avoid DATABASE_URL requirement
vi.mock('../../server/storage', () => ({
  storage: {
    getListBlocksForUsers: mockGetListBlocksForUsers,
    getListMutesForUsers: mockGetListMutesForUsers,
  },
}));

// Mock the oauth service
vi.mock('../../server/services/oauth-service', () => ({
  oauthService: {
    getSession: mockGetSession,
  },
}));

// Mock the Agent from @atproto/api
vi.mock('@atproto/api', () => ({
  Agent: class MockAgent {
    app = {
      bsky: {
        feed: {
          searchPosts: mockSearchPosts,
        },
        actor: {
          searchActors: mockSearchActors,
        },
        graph: {
          searchStarterPacks: mockSearchStarterPacks,
        },
      },
    };
  },
}));

describe('Pass-Through Search Service', () => {
  let passThroughSearchService: typeof import('../../server/services/pass-through-search').passThroughSearchService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: no blocks or mutes
    mockGetListBlocksForUsers.mockResolvedValue(new Map());
    mockGetListMutesForUsers.mockResolvedValue(new Map());

    const module = await import('../../server/services/pass-through-search');
    passThroughSearchService = module.passThroughSearchService;
  });

  describe('Cursor encoding and decoding', () => {
    it('should encode merged cursor as base64 JSON', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);
      mockSearchPosts.mockResolvedValue({
        data: { posts: [], cursor: 'remote-cursor-123' },
      } as never);

      const result = await passThroughSearchService.augmentPostSearch(
        [],
        'local-cursor-456',
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      expect(result.cursor).toBeDefined();
      const decoded = JSON.parse(
        Buffer.from(result.cursor!, 'base64').toString()
      );
      expect(decoded).toEqual({
        local: 'local-cursor-456',
        remote: 'remote-cursor-123',
      });
    });

    it('should return undefined cursor when both cursors are undefined', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);
      mockSearchPosts.mockResolvedValue({
        data: { posts: [], cursor: undefined },
      } as never);

      const result = await passThroughSearchService.augmentPostSearch(
        [],
        undefined,
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      expect(result.cursor).toBeUndefined();
    });

    it('should encode cursor with only local cursor when remote is exhausted', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);
      mockSearchPosts.mockResolvedValue({
        data: { posts: [], cursor: undefined },
      } as never);

      const result = await passThroughSearchService.augmentPostSearch(
        [],
        'local-cursor-still-going',
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      expect(result.cursor).toBeDefined();
      const decoded = JSON.parse(
        Buffer.from(result.cursor!, 'base64').toString()
      );
      expect(decoded).toEqual({
        local: 'local-cursor-still-going',
      });
    });

    it('should encode cursor with only remote cursor when local is exhausted', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);
      mockSearchPosts.mockResolvedValue({
        data: { posts: [], cursor: 'remote-cursor-still-going' },
      } as never);

      const result = await passThroughSearchService.augmentPostSearch(
        [],
        undefined,
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      expect(result.cursor).toBeDefined();
      const decoded = JSON.parse(
        Buffer.from(result.cursor!, 'base64').toString()
      );
      expect(decoded).toEqual({
        remote: 'remote-cursor-still-going',
      });
    });

    it('should decode merged cursor on subsequent pagination request', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);
      mockSearchPosts.mockResolvedValue({
        data: { posts: [], cursor: 'new-remote-cursor' },
      } as never);

      // Create a merged cursor
      const mergedCursor = Buffer.from(
        JSON.stringify({ local: 'old-local', remote: 'old-remote' })
      ).toString('base64');

      await passThroughSearchService.augmentPostSearch(
        [],
        'new-local-cursor',
        'test query',
        { limit: 25, cursor: mergedCursor },
        'did:plc:test'
      );

      // Verify the remote search was called with the decoded remote cursor
      expect(mockSearchPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: 'old-remote',
        })
      );
    });

    it('should handle legacy non-merged cursors gracefully', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);
      mockSearchPosts.mockResolvedValue({
        data: { posts: [], cursor: 'remote-cursor' },
      } as never);

      // Pass a plain string cursor (legacy format)
      const result = await passThroughSearchService.augmentPostSearch(
        [],
        'new-local',
        'test query',
        { limit: 25, cursor: 'legacy-cursor' },
        'did:plc:test'
      );

      // Should still work and create new merged cursor
      expect(result.cursor).toBeDefined();
    });
  });

  describe('Post search augmentation - Deduplication', () => {
    it('should merge local and remote posts without duplicates', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);

      const localPosts: PostSearchResult[] = [
        {
          uri: 'at://did:plc:local/app.bsky.feed.post/1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Local post',
          embed: null,
          parentUri: null,
          rootUri: null,
          createdAt: new Date('2024-01-01'),
          indexedAt: new Date('2024-01-01'),
          searchVector: null,
          rank: 1.0,
        },
      ];

      mockSearchPosts.mockResolvedValue({
        data: {
          posts: [
            {
              uri: 'at://did:plc:local/app.bsky.feed.post/1', // Duplicate
              cid: 'cid1',
              author: { did: 'did:plc:author1' },
              record: {
                text: 'Local post (remote version - should be ignored)',
                createdAt: '2024-01-01T00:00:00Z',
              },
              indexedAt: '2024-01-01T00:00:00Z',
            },
            {
              uri: 'at://did:plc:remote/app.bsky.feed.post/2', // Unique
              cid: 'cid2',
              author: { did: 'did:plc:author2' },
              record: {
                text: 'Remote post',
                createdAt: '2024-01-02T00:00:00Z',
              },
              indexedAt: '2024-01-02T00:00:00Z',
            },
          ],
          cursor: 'remote-cursor',
        },
      } as never);

      const result = await passThroughSearchService.augmentPostSearch(
        localPosts,
        'local-cursor',
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      // Should have 2 posts (1 local + 1 unique remote)
      expect(result.posts).toHaveLength(2);

      // Local version should be preserved (not remote version)
      const localPost = result.posts.find(
        (p) => p.uri === 'at://did:plc:local/app.bsky.feed.post/1'
      );
      expect(localPost).toBeDefined();
      expect(localPost!.text).toBe('Local post'); // Local version, not remote

      // Remote unique post should be included
      const remotePost = result.posts.find(
        (p) => p.uri === 'at://did:plc:remote/app.bsky.feed.post/2'
      );
      expect(remotePost).toBeDefined();
      expect(remotePost!.text).toBe('Remote post');
    });

    it('should handle all remote posts being duplicates', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);

      const localPosts: PostSearchResult[] = [
        {
          uri: 'at://did:plc:local/app.bsky.feed.post/1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Post 1',
          embed: null,
          parentUri: null,
          rootUri: null,
          createdAt: new Date('2024-01-01'),
          indexedAt: new Date('2024-01-01'),
          searchVector: null,
          rank: 1.0,
        },
        {
          uri: 'at://did:plc:local/app.bsky.feed.post/2',
          cid: 'cid2',
          authorDid: 'did:plc:author2',
          text: 'Post 2',
          embed: null,
          parentUri: null,
          rootUri: null,
          createdAt: new Date('2024-01-02'),
          indexedAt: new Date('2024-01-02'),
          searchVector: null,
          rank: 0.9,
        },
      ];

      mockSearchPosts.mockResolvedValue({
        data: {
          posts: [
            {
              uri: 'at://did:plc:local/app.bsky.feed.post/1',
              cid: 'cid1',
              author: { did: 'did:plc:author1' },
              record: { text: 'Post 1', createdAt: '2024-01-01T00:00:00Z' },
              indexedAt: '2024-01-01T00:00:00Z',
            },
            {
              uri: 'at://did:plc:local/app.bsky.feed.post/2',
              cid: 'cid2',
              author: { did: 'did:plc:author2' },
              record: { text: 'Post 2', createdAt: '2024-01-02T00:00:00Z' },
              indexedAt: '2024-01-02T00:00:00Z',
            },
          ],
        },
      } as never);

      const result = await passThroughSearchService.augmentPostSearch(
        localPosts,
        undefined,
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      // Should still have only 2 posts (all remote were duplicates)
      expect(result.posts).toHaveLength(2);
    });
  });

  describe('Post search augmentation - Sorting', () => {
    it('should sort merged posts by rank when sort is top', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);

      const localPosts: PostSearchResult[] = [
        {
          uri: 'at://did:plc:local/app.bsky.feed.post/1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Low rank post',
          embed: null,
          parentUri: null,
          rootUri: null,
          createdAt: new Date('2024-01-01'),
          indexedAt: new Date('2024-01-01'),
          searchVector: null,
          rank: 0.3,
        },
      ];

      mockSearchPosts.mockResolvedValue({
        data: {
          posts: [
            {
              uri: 'at://did:plc:remote/app.bsky.feed.post/2',
              cid: 'cid2',
              author: { did: 'did:plc:author2' },
              record: {
                text: 'High rank post',
                createdAt: '2024-01-02T00:00:00Z',
              },
              indexedAt: '2024-01-02T00:00:00Z',
            },
          ],
        },
      } as never);

      const result = await passThroughSearchService.augmentPostSearch(
        localPosts,
        undefined,
        'test query',
        { limit: 25, sort: 'top' },
        'did:plc:test'
      );

      // Remote post should be first (rank 0.5 default > 0.3 local)
      expect(result.posts[0].uri).toBe(
        'at://did:plc:remote/app.bsky.feed.post/2'
      );
      expect(result.posts[1].uri).toBe(
        'at://did:plc:local/app.bsky.feed.post/1'
      );
    });

    it('should sort merged posts by createdAt when sort is latest', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);

      const localPosts: PostSearchResult[] = [
        {
          uri: 'at://did:plc:local/app.bsky.feed.post/1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Older post',
          embed: null,
          parentUri: null,
          rootUri: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          indexedAt: new Date('2024-01-01'),
          searchVector: null,
          rank: 1.0,
        },
      ];

      mockSearchPosts.mockResolvedValue({
        data: {
          posts: [
            {
              uri: 'at://did:plc:remote/app.bsky.feed.post/2',
              cid: 'cid2',
              author: { did: 'did:plc:author2' },
              record: {
                text: 'Newer post',
                createdAt: '2024-01-02T00:00:00Z',
              },
              indexedAt: '2024-01-02T00:00:00Z',
            },
          ],
        },
      } as never);

      const result = await passThroughSearchService.augmentPostSearch(
        localPosts,
        undefined,
        'test query',
        { limit: 25, sort: 'latest' },
        'did:plc:test'
      );

      // Remote post should be first (newer timestamp)
      expect(result.posts[0].uri).toBe(
        'at://did:plc:remote/app.bsky.feed.post/2'
      );
      expect(result.posts[0].createdAt.getTime()).toBeGreaterThan(
        result.posts[1].createdAt.getTime()
      );
      expect(result.posts[1].uri).toBe(
        'at://did:plc:local/app.bsky.feed.post/1'
      );
    });
  });

  describe('Actor search augmentation - Deduplication', () => {
    it('should merge local and remote actors without duplicates', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);

      const localActors: ActorSearchResult[] = [
        {
          did: 'did:plc:actor1',
          handle: 'local.bsky.social',
          displayName: 'Local Actor',
          avatarUrl: null,
          description: null,
          rank: 1.0,
        },
      ];

      mockSearchActors.mockResolvedValue({
        data: {
          actors: [
            {
              did: 'did:plc:actor1', // Duplicate
              handle: 'local.bsky.social',
              displayName: 'Local Actor (remote - should be ignored)',
            },
            {
              did: 'did:plc:actor2', // Unique
              handle: 'remote.bsky.social',
              displayName: 'Remote Actor',
            },
          ],
        },
      } as never);

      const result = await passThroughSearchService.augmentActorSearch(
        localActors,
        undefined,
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      // Should have 2 actors (1 local + 1 unique remote)
      expect(result.actors).toHaveLength(2);

      // Verify local version is preserved
      const localActor = result.actors.find((a) => a.did === 'did:plc:actor1');
      expect(localActor!.displayName).toBe('Local Actor'); // Not remote version

      // Verify remote unique actor is included
      expect(result.actors.some((a) => a.did === 'did:plc:actor2')).toBe(true);
    });
  });

  describe('Authentication handling', () => {
    it('should return local results only when no user DID provided', async () => {
      const localPosts: PostSearchResult[] = [
        {
          uri: 'at://did:plc:local/app.bsky.feed.post/1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Local post',
          embed: null,
          parentUri: null,
          rootUri: null,
          createdAt: new Date('2024-01-01'),
          indexedAt: new Date('2024-01-01'),
          searchVector: null,
          rank: 1.0,
        },
      ];

      const result = await passThroughSearchService.augmentPostSearch(
        localPosts,
        'local-cursor',
        'test query',
        { limit: 25 },
        undefined // No user DID
      );

      expect(result.posts).toEqual(localPosts);
      expect(result.cursor).toBe('local-cursor');
      expect(mockGetSession).not.toHaveBeenCalled();
      expect(mockSearchPosts).not.toHaveBeenCalled();
    });

    it('should return local results only when OAuth session not found', async () => {
      mockGetSession.mockResolvedValue(null);

      const localPosts: PostSearchResult[] = [
        {
          uri: 'at://did:plc:local/app.bsky.feed.post/1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Local post',
          embed: null,
          parentUri: null,
          rootUri: null,
          createdAt: new Date('2024-01-01'),
          indexedAt: new Date('2024-01-01'),
          searchVector: null,
          rank: 1.0,
        },
      ];

      const result = await passThroughSearchService.augmentPostSearch(
        localPosts,
        'local-cursor',
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      expect(result.posts).toEqual(localPosts);
      expect(result.cursor).toBe('local-cursor');
      expect(mockSearchPosts).not.toHaveBeenCalled();
    });

    it('should gracefully handle remote API errors', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);
      mockSearchPosts.mockRejectedValue(new Error('Network error'));

      const localPosts: PostSearchResult[] = [
        {
          uri: 'at://did:plc:local/app.bsky.feed.post/1',
          cid: 'cid1',
          authorDid: 'did:plc:author1',
          text: 'Local post',
          embed: null,
          parentUri: null,
          rootUri: null,
          createdAt: new Date('2024-01-01'),
          indexedAt: new Date('2024-01-01'),
          searchVector: null,
          rank: 1.0,
        },
      ];

      const result = await passThroughSearchService.augmentPostSearch(
        localPosts,
        'local-cursor',
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      // Should fall back to local results
      expect(result.posts).toEqual(localPosts);
    });
  });

  describe('Starter pack search augmentation', () => {
    it('should merge local and remote starter packs without duplicates', async () => {
      mockGetSession.mockResolvedValue({ did: 'did:plc:test' } as never);

      const localPacks = [
        {
          uri: 'at://did:plc:creator1/app.bsky.graph.starterpack/1',
          cid: 'cid1',
          creatorDid: 'did:plc:creator1',
          name: 'Local Pack',
          description: null,
          createdAt: new Date('2024-01-01'),
        },
      ];

      mockSearchStarterPacks.mockResolvedValue({
        data: {
          starterPacks: [
            {
              uri: 'at://did:plc:creator1/app.bsky.graph.starterpack/1', // Duplicate
              cid: 'cid1',
              creator: { did: 'did:plc:creator1' },
              record: {
                name: 'Local Pack (remote - should be ignored)',
                createdAt: '2024-01-01T00:00:00Z',
              },
              indexedAt: '2024-01-01T00:00:00Z',
            },
            {
              uri: 'at://did:plc:creator2/app.bsky.graph.starterpack/2', // Unique
              cid: 'cid2',
              creator: { did: 'did:plc:creator2' },
              record: {
                name: 'Remote Pack',
                createdAt: '2024-01-02T00:00:00Z',
              },
              indexedAt: '2024-01-02T00:00:00Z',
            },
          ],
        },
      } as never);

      const result = await passThroughSearchService.augmentStarterPackSearch(
        localPacks,
        undefined,
        'test query',
        { limit: 25 },
        'did:plc:test'
      );

      // Should have 2 packs (1 local + 1 unique remote)
      expect(result.starterPacks).toHaveLength(2);

      // Verify local version is preserved
      const localPack = result.starterPacks.find(
        (p) => p.uri === 'at://did:plc:creator1/app.bsky.graph.starterpack/1'
      );
      expect(localPack!.name).toBe('Local Pack'); // Not remote version

      // Verify remote unique pack is included
      expect(
        result.starterPacks.some(
          (p) => p.uri === 'at://did:plc:creator2/app.bsky.graph.starterpack/2'
        )
      ).toBe(true);
    });
  });
});
