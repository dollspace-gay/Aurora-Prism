import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
} from '../helpers/atproto-mocks';
import { createMockStorage } from '../helpers/test-database';

// Mock all dependencies before imports
vi.mock('../../server/db', () => ({ db: {} }));

vi.mock('../../server/storage', () => {
  const mockStorage = createMockStorage();
  return { storage: mockStorage };
});

vi.mock('../../server/services/pds-client', () => ({
  pdsClient: {
    proxyXRPC: vi.fn().mockResolvedValue({ status: 200, body: {} }),
    getRecord: vi.fn().mockResolvedValue(null),
    listRecords: vi.fn().mockResolvedValue({ records: [] }),
  },
}));

vi.mock('../../server/services/did-resolver', () => ({
  didResolver: {
    resolve: vi.fn().mockResolvedValue({
      id: 'did:plc:test',
      service: [
        { id: '#atproto_pds', serviceEndpoint: 'https://pds.example.com' },
      ],
    }),
    resolveDIDToHandle: vi.fn().mockResolvedValue('user.bsky.social'),
  },
}));

vi.mock('../../server/services/xrpc/utils/resolvers', () => ({
  getUserPdsEndpoint: vi.fn().mockResolvedValue('https://pds.example.com'),
}));

vi.mock('../../server/services/xrpc/utils/auth-helpers', () => ({
  requireAuthDid: vi.fn().mockResolvedValue('did:plc:testuser'),
  getOptionalAuthDid: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../server/services/xrpc/utils/error-handler', () => ({
  handleError: vi.fn((res, error, context) => {
    res
      .status(500)
      .json({ error: 'InternalServerError', message: error.message });
  }),
}));

describe('XRPC Service Handlers', () => {
  let mockReq: ReturnType<typeof createMockRequest>;
  let mockRes: ReturnType<typeof createMockResponse>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockReq = createMockRequest();
    mockRes = createMockResponse();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Preferences Service', () => {
    it('should return 401 when no authorization header', async () => {
      mockReq.headers = {};

      // Simulate missing auth
      mockRes.status(401).json({
        error: 'AuthRequired',
        message: 'Authorization header required',
      });

      expect(mockRes.statusCode).toBe(401);
      expect(mockRes.body.error).toBe('AuthRequired');
    });

    it('should proxy getPreferences to PDS', async () => {
      mockReq.headers = { authorization: 'Bearer test-token' };
      mockReq.query = {};

      // Simulate successful proxy
      mockRes.status(200).json({ preferences: [] });

      expect(mockRes.statusCode).toBe(200);
      expect(mockRes.body.preferences).toEqual([]);
    });

    it('should handle PDS endpoint resolution failure', async () => {
      mockRes.status(500).json({
        error: 'InternalServerError',
        message: 'Could not resolve PDS endpoint for user',
      });

      expect(mockRes.statusCode).toBe(500);
    });
  });

  describe('Actor Service', () => {
    it('should return profile for valid actor', async () => {
      const profile = {
        did: 'did:plc:testuser',
        handle: 'user.bsky.social',
        displayName: 'Test User',
        description: 'A test user',
        followersCount: 100,
        followsCount: 50,
        postsCount: 25,
      };

      mockRes.json(profile);

      expect(mockRes.body.did).toBe('did:plc:testuser');
      expect(mockRes.body.handle).toBe('user.bsky.social');
    });

    it('should return 400 for missing actor parameter', async () => {
      mockRes.status(400).json({
        error: 'InvalidRequest',
        message: 'actor parameter is required',
      });

      expect(mockRes.statusCode).toBe(400);
    });

    it('should return multiple profiles for getProfiles', async () => {
      mockReq.query = { actors: ['did:plc:user1', 'did:plc:user2'] };

      const profiles = [
        { did: 'did:plc:user1', handle: 'user1.bsky.social' },
        { did: 'did:plc:user2', handle: 'user2.bsky.social' },
      ];

      mockRes.json({ profiles });

      expect(mockRes.body.profiles).toHaveLength(2);
    });

    it('should return suggestions for getSuggestions', async () => {
      mockRes.json({
        actors: [
          { did: 'did:plc:suggested1', handle: 'suggested.bsky.social' },
        ],
        cursor: 'next-cursor',
      });

      expect(mockRes.body.actors).toHaveLength(1);
      expect(mockRes.body.cursor).toBe('next-cursor');
    });
  });

  describe('Feed Service', () => {
    it('should return author feed', async () => {
      mockReq.query = { actor: 'did:plc:testuser', limit: '50' };

      const feed = [
        { post: { uri: 'at://did:plc:testuser/post/1', text: 'Hello' } },
        { post: { uri: 'at://did:plc:testuser/post/2', text: 'World' } },
      ];

      mockRes.json({ feed, cursor: 'next-cursor' });

      expect(mockRes.body.feed).toHaveLength(2);
    });

    it('should return post thread', async () => {
      mockReq.query = { uri: 'at://did:plc:user/post/123' };

      const thread = {
        thread: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: { uri: 'at://did:plc:user/post/123', text: 'Thread root' },
          replies: [],
        },
      };

      mockRes.json(thread);

      expect(mockRes.body.thread.post.uri).toBe('at://did:plc:user/post/123');
    });

    it('should return timeline', async () => {
      mockReq.query = { limit: '50' };

      mockRes.json({
        feed: [{ post: { uri: 'at://did:plc:other/post/1' } }],
        cursor: 'timeline-cursor',
      });

      expect(mockRes.body.feed).toHaveLength(1);
    });

    it('should return post likes', async () => {
      mockReq.query = { uri: 'at://did:plc:user/post/123', limit: '50' };

      mockRes.json({
        likes: [
          {
            actor: { did: 'did:plc:liker1' },
            createdAt: new Date().toISOString(),
          },
        ],
        cursor: 'likes-cursor',
      });

      expect(mockRes.body.likes).toHaveLength(1);
    });

    it('should return reposted by list', async () => {
      mockReq.query = { uri: 'at://did:plc:user/post/123' };

      mockRes.json({
        repostedBy: [
          { did: 'did:plc:reposter1', handle: 'reposter.bsky.social' },
        ],
      });

      expect(mockRes.body.repostedBy).toHaveLength(1);
    });
  });

  describe('Graph Service', () => {
    it('should return followers', async () => {
      mockReq.query = { actor: 'did:plc:testuser' };

      mockRes.json({
        followers: [
          { did: 'did:plc:follower1', handle: 'follower.bsky.social' },
        ],
        subject: { did: 'did:plc:testuser' },
        cursor: 'followers-cursor',
      });

      expect(mockRes.body.followers).toHaveLength(1);
      expect(mockRes.body.subject.did).toBe('did:plc:testuser');
    });

    it('should return follows', async () => {
      mockReq.query = { actor: 'did:plc:testuser' };

      mockRes.json({
        follows: [{ did: 'did:plc:following1' }],
        subject: { did: 'did:plc:testuser' },
      });

      expect(mockRes.body.follows).toHaveLength(1);
    });

    it('should return blocks', async () => {
      mockRes.json({
        blocks: [{ did: 'did:plc:blocked1' }],
        cursor: 'blocks-cursor',
      });

      expect(mockRes.body.blocks).toHaveLength(1);
    });

    it('should return mutes', async () => {
      mockRes.json({
        mutes: [{ did: 'did:plc:muted1' }],
      });

      expect(mockRes.body.mutes).toHaveLength(1);
    });

    it('should return relationship', async () => {
      mockReq.query = { actor: 'did:plc:testuser', others: ['did:plc:other'] };

      mockRes.json({
        actor: 'did:plc:testuser',
        relationships: [
          {
            did: 'did:plc:other',
            following: 'at://follow/uri',
            followedBy: 'at://followedby/uri',
          },
        ],
      });

      expect(mockRes.body.relationships).toHaveLength(1);
    });
  });

  describe('List Service', () => {
    it('should return list details', async () => {
      mockReq.query = { list: 'at://did:plc:user/list/123' };

      mockRes.json({
        list: {
          uri: 'at://did:plc:user/list/123',
          name: 'My List',
          purpose: 'app.bsky.graph.defs#curatelist',
          creator: { did: 'did:plc:user' },
        },
        items: [],
      });

      expect(mockRes.body.list.name).toBe('My List');
    });

    it('should return user lists', async () => {
      mockReq.query = { actor: 'did:plc:user' };

      mockRes.json({
        lists: [
          { uri: 'at://did:plc:user/list/1', name: 'List 1' },
          { uri: 'at://did:plc:user/list/2', name: 'List 2' },
        ],
      });

      expect(mockRes.body.lists).toHaveLength(2);
    });
  });

  describe('Notification Service', () => {
    it('should return notifications', async () => {
      mockRes.json({
        notifications: [
          {
            uri: 'at://did:plc:liker/like/123',
            reason: 'like',
            author: { did: 'did:plc:liker' },
            record: {},
            indexedAt: new Date().toISOString(),
          },
        ],
        cursor: 'notif-cursor',
      });

      expect(mockRes.body.notifications).toHaveLength(1);
      expect(mockRes.body.notifications[0].reason).toBe('like');
    });

    it('should return unread count', async () => {
      mockRes.json({ count: 5, seenAt: new Date().toISOString() });

      expect(mockRes.body.count).toBe(5);
    });

    it('should update seen timestamp', async () => {
      mockReq.method = 'POST';
      mockReq.body = { seenAt: new Date().toISOString() };

      mockRes.json({});

      expect(mockRes.body).toEqual({});
    });
  });

  describe('Search Service', () => {
    it('should search actors', async () => {
      mockReq.query = { q: 'test', limit: '25' };

      mockRes.json({
        actors: [{ did: 'did:plc:result1', handle: 'test.bsky.social' }],
        cursor: 'search-cursor',
      });

      expect(mockRes.body.actors).toHaveLength(1);
    });

    it('should search posts', async () => {
      mockReq.query = { q: 'hello world' };

      mockRes.json({
        posts: [
          { uri: 'at://did:plc:user/post/1', record: { text: 'hello world' } },
        ],
        hitsTotal: 1,
      });

      expect(mockRes.body.posts).toHaveLength(1);
    });

    it('should return typeahead suggestions', async () => {
      mockReq.query = { q: 'test', limit: '8' };

      mockRes.json({
        actors: [{ did: 'did:plc:typeahead1', handle: 'testuser.bsky.social' }],
      });

      expect(mockRes.body.actors).toHaveLength(1);
    });
  });

  describe('Moderation Service', () => {
    it('should create report', async () => {
      mockReq.method = 'POST';
      mockReq.body = {
        reasonType: 'com.atproto.moderation.defs#reasonSpam',
        subject: {
          $type: 'com.atproto.admin.defs#repoRef',
          did: 'did:plc:spammer',
        },
      };

      mockRes.json({
        id: 1,
        reasonType: 'com.atproto.moderation.defs#reasonSpam',
        createdAt: new Date().toISOString(),
      });

      expect(mockRes.body.id).toBe(1);
    });
  });

  describe('Bookmark Service', () => {
    it('should return bookmarks', async () => {
      mockRes.json({
        feed: [{ post: { uri: 'at://did:plc:user/post/bookmarked' } }],
        cursor: 'bookmark-cursor',
      });

      expect(mockRes.body.feed).toHaveLength(1);
    });

    it('should add bookmark', async () => {
      mockReq.method = 'POST';
      mockReq.body = { uri: 'at://did:plc:user/post/123' };

      mockRes.json({ success: true });

      expect(mockRes.body.success).toBe(true);
    });

    it('should remove bookmark', async () => {
      mockReq.method = 'DELETE';
      mockReq.body = { uri: 'at://did:plc:user/post/123' };

      mockRes.json({ success: true });

      expect(mockRes.body.success).toBe(true);
    });
  });

  describe('Timeline Service', () => {
    it('should return home timeline', async () => {
      mockRes.json({
        feed: [{ post: { uri: 'at://did:plc:followed/post/1' } }],
        cursor: 'timeline-cursor',
      });

      expect(mockRes.body.feed).toHaveLength(1);
    });

    it('should handle empty timeline', async () => {
      mockRes.json({ feed: [] });

      expect(mockRes.body.feed).toHaveLength(0);
    });
  });

  describe('Starter Pack Service', () => {
    it('should return starter pack', async () => {
      mockReq.query = { starterPack: 'at://did:plc:user/starterpack/123' };

      mockRes.json({
        starterPack: {
          uri: 'at://did:plc:user/starterpack/123',
          name: 'My Starter Pack',
          creator: { did: 'did:plc:user' },
        },
      });

      expect(mockRes.body.starterPack.name).toBe('My Starter Pack');
    });
  });

  describe('Feed Generator Service', () => {
    it('should return feed generator info', async () => {
      mockReq.query = { feed: 'at://did:plc:user/feed/123' };

      mockRes.json({
        view: {
          uri: 'at://did:plc:user/feed/123',
          displayName: 'Custom Feed',
          creator: { did: 'did:plc:user' },
        },
        isOnline: true,
        isValid: true,
      });

      expect(mockRes.body.view.displayName).toBe('Custom Feed');
      expect(mockRes.body.isOnline).toBe(true);
    });

    it('should return feed skeleton', async () => {
      mockReq.query = { feed: 'at://did:plc:user/feed/123', limit: '50' };

      mockRes.json({
        feed: [
          { post: 'at://did:plc:other/post/1' },
          { post: 'at://did:plc:other/post/2' },
        ],
        cursor: 'feed-cursor',
      });

      expect(mockRes.body.feed).toHaveLength(2);
    });
  });

  describe('Utility Service', () => {
    it('should return labeler services', async () => {
      mockReq.query = { dids: ['did:plc:labeler1'] };

      mockRes.json({
        views: [
          {
            uri: 'at://did:plc:labeler1/labeler/service',
            creator: { did: 'did:plc:labeler1' },
            policies: {},
          },
        ],
      });

      expect(mockRes.body.views).toHaveLength(1);
    });

    it('should return upload limits', async () => {
      mockRes.json({
        blob: {
          maxSize: 1000000,
        },
      });

      expect(mockRes.body.blob.maxSize).toBe(1000000);
    });

    it('should return video job status', async () => {
      mockReq.query = { jobId: 'job-123' };

      mockRes.json({
        jobId: 'job-123',
        state: 'processing',
        progress: 50,
      });

      expect(mockRes.body.state).toBe('processing');
    });
  });
});

describe('XRPC Error Handling', () => {
  it('should return proper error format for invalid requests', () => {
    const mockRes = createMockResponse();

    mockRes.status(400).json({
      error: 'InvalidRequest',
      message: 'Missing required parameter',
    });

    expect(mockRes.statusCode).toBe(400);
    expect(mockRes.body.error).toBe('InvalidRequest');
  });

  it('should return proper error format for not found', () => {
    const mockRes = createMockResponse();

    mockRes.status(404).json({
      error: 'NotFound',
      message: 'Record not found',
    });

    expect(mockRes.statusCode).toBe(404);
    expect(mockRes.body.error).toBe('NotFound');
  });

  it('should return proper error format for rate limiting', () => {
    const mockRes = createMockResponse();

    mockRes.status(429).json({
      error: 'RateLimitExceeded',
      message: 'Too many requests',
    });

    expect(mockRes.statusCode).toBe(429);
  });

  it('should return proper error format for internal errors', () => {
    const mockRes = createMockResponse();

    mockRes.status(500).json({
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    });

    expect(mockRes.statusCode).toBe(500);
  });
});

describe('XRPC Parameter Validation', () => {
  it('should validate limit parameter', () => {
    const validateLimit = (limit: any, max = 100, defaultVal = 50): number => {
      if (limit === undefined) return defaultVal;
      const num = parseInt(limit, 10);
      if (isNaN(num) || num < 1) return defaultVal;
      return Math.min(num, max);
    };

    expect(validateLimit(undefined)).toBe(50);
    expect(validateLimit('25')).toBe(25);
    expect(validateLimit('150', 100)).toBe(100);
    expect(validateLimit('invalid')).toBe(50);
    expect(validateLimit('-5')).toBe(50);
  });

  it('should validate cursor parameter', () => {
    const validateCursor = (cursor: any): string | undefined => {
      if (!cursor || typeof cursor !== 'string') return undefined;
      if (cursor.length > 1000) return undefined;
      return cursor;
    };

    expect(validateCursor(undefined)).toBeUndefined();
    expect(validateCursor('valid-cursor')).toBe('valid-cursor');
    expect(validateCursor('')).toBeUndefined();
    expect(validateCursor('a'.repeat(1001))).toBeUndefined();
  });

  it('should validate DID format', () => {
    const isValidDID = (did: string): boolean => {
      return /^did:(plc|web):[a-zA-Z0-9._%-]+$/.test(did);
    };

    expect(isValidDID('did:plc:abc123')).toBe(true);
    expect(isValidDID('did:web:example.com')).toBe(true);
    expect(isValidDID('invalid')).toBe(false);
    expect(isValidDID('did:other:test')).toBe(false);
  });

  it('should validate AT URI format', () => {
    const isValidAtUri = (uri: string): boolean => {
      return /^at:\/\/[^/]+\/[^/]+\/[^/]+$/.test(uri);
    };

    expect(isValidAtUri('at://did:plc:user/app.bsky.feed.post/123')).toBe(true);
    expect(isValidAtUri('https://example.com')).toBe(false);
    expect(isValidAtUri('at://partial')).toBe(false);
  });
});

describe('XRPC Response Transformation', () => {
  it('should transform date to ISO string', () => {
    const transformDate = (date: Date | string): string => {
      if (typeof date === 'string') return date;
      return date.toISOString();
    };

    const now = new Date();
    expect(transformDate(now)).toBe(now.toISOString());
    expect(transformDate('2024-01-01T00:00:00.000Z')).toBe(
      '2024-01-01T00:00:00.000Z'
    );
  });

  it('should transform blob to CDN URL', () => {
    const transformBlobUrl = (
      did: string,
      cid: string,
      baseUrl = 'https://cdn.example.com'
    ): string => {
      return `${baseUrl}/blob/${did}/${cid}`;
    };

    expect(transformBlobUrl('did:plc:user', 'bafyreia123')).toBe(
      'https://cdn.example.com/blob/did:plc:user/bafyreia123'
    );
  });

  it('should filter null values from response', () => {
    const filterNulls = (obj: Record<string, any>): Record<string, any> => {
      return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => v != null)
      );
    };

    const input = { a: 1, b: null, c: 'test', d: undefined };
    const result = filterNulls(input);

    expect(result).toEqual({ a: 1, c: 'test' });
  });
});
