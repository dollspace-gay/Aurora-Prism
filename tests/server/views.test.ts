import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Views } from '../../server/services/views';
import type { FeedItem, HydrationState } from '../../server/types/feed';

describe('Views Service', () => {
  let views: Views;

  beforeEach(() => {
    views = new Views();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const createHydrationState = (overrides: Partial<HydrationState> = {}): HydrationState => ({
    posts: new Map(),
    reposts: new Map(),
    profileViewers: new Map(),
    aggregations: new Map(),
    viewerStates: new Map(),
    labels: new Map(),
    threadContexts: new Map(),
    ...overrides,
  });

  describe('feedViewPost', () => {
    it('should return undefined when post is not in hydration state', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const state = createHydrationState();

      const result = views.feedViewPost(item, state);

      expect(result).toBeUndefined();
    });

    it('should return FeedViewPost for a simple post', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            cid: 'cid1',
            record: { text: 'Hello world' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result).toBeDefined();
      expect(result!.post.uri).toBe('at://post1');
      expect(result!.post.cid).toBe('cid1');
      expect(result!.reason).toBeUndefined();
      expect(result!.reply).toBeUndefined();
    });

    it('should include aggregation data in post', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            cid: 'cid1',
            record: { text: 'Hello' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
        aggregations: new Map([
          ['at://post1', {
            replyCount: 5,
            repostCount: 10,
            likeCount: 100,
            bookmarkCount: 2,
            quoteCount: 3,
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result!.post.replyCount).toBe(5);
      expect(result!.post.repostCount).toBe(10);
      expect(result!.post.likeCount).toBe(100);
      expect(result!.post.bookmarkCount).toBe(2);
      expect(result!.post.quoteCount).toBe(3);
    });

    it('should include viewer state when available', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            cid: 'cid1',
            record: { text: 'Hello' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
        viewerStates: new Map([
          ['at://post1', {
            likeUri: 'at://like1',
            repostUri: 'at://repost1',
            bookmarked: true,
            threadMuted: false,
            replyDisabled: false,
            embeddingDisabled: false,
            pinned: true,
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result!.post.viewer.like).toBe('at://like1');
      expect(result!.post.viewer.repost).toBe('at://repost1');
      expect(result!.post.viewer.bookmarked).toBe(true);
      expect(result!.post.viewer.pinned).toBe(true);
    });

    it('should include labels when available', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const labels = [{ val: 'spam', src: 'did:plc:labeler' }];
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            cid: 'cid1',
            record: { text: 'Hello' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
        labels: new Map([['at://post1', labels]]),
      });

      const result = views.feedViewPost(item, state);

      expect(result!.post.labels).toEqual(labels);
    });

    it('should handle repost items', () => {
      const item: FeedItem = {
        post: { uri: 'at://original-post' },
        repost: { uri: 'at://repost1' },
      };
      const state = createHydrationState({
        posts: new Map([
          ['at://original-post', {
            uri: 'at://original-post',
            cid: 'cid1',
            record: { text: 'Original post' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
        reposts: new Map([
          ['at://repost1', {
            uri: 'at://repost1',
            cid: 'repost-cid',
            userDid: 'did:plc:reposter',
            record: { subject: { uri: 'at://original-post' } },
            indexedAt: '2024-01-02T00:00:00Z',
          }],
        ]),
        profileViewers: new Map([
          ['did:plc:reposter', {
            handle: 'reposter.bsky.social',
            displayName: 'Reposter',
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result).toBeDefined();
      expect(result!.reason).toBeDefined();
      expect(result!.reason.$type).toBe('app.bsky.feed.defs#reasonRepost');
      expect(result!.reason.by.handle).toBe('reposter.bsky.social');
    });

    it('should return undefined for repost with missing repost data', () => {
      const item: FeedItem = {
        post: { uri: 'at://original-post' },
        repost: { uri: 'at://missing-repost' },
      };
      const state = createHydrationState({
        posts: new Map([
          ['at://original-post', {
            uri: 'at://original-post',
            cid: 'cid1',
            record: { text: 'Original post' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result).toBeUndefined();
    });

    it('should return undefined for repost with mismatched subject', () => {
      const item: FeedItem = {
        post: { uri: 'at://original-post' },
        repost: { uri: 'at://repost1' },
      };
      const state = createHydrationState({
        posts: new Map([
          ['at://original-post', {
            uri: 'at://original-post',
            cid: 'cid1',
            record: { text: 'Original post' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
        reposts: new Map([
          ['at://repost1', {
            uri: 'at://repost1',
            cid: 'repost-cid',
            record: { subject: { uri: 'at://different-post' } }, // Different post
            indexedAt: '2024-01-02T00:00:00Z',
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result).toBeUndefined();
    });

    it('should handle pinned posts', () => {
      const item: FeedItem = {
        post: { uri: 'at://post1' },
        authorPinned: true,
      };
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            cid: 'cid1',
            record: { text: 'Pinned post' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
        profileViewers: new Map([
          ['did:plc:author1', {
            handle: 'author.bsky.social',
            displayName: 'Author',
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result).toBeDefined();
      expect(result!.reason).toBeDefined();
      expect(result!.reason.$type).toBe('app.bsky.feed.defs#reasonPin');
    });

    it('should handle reply posts', () => {
      const item: FeedItem = { post: { uri: 'at://reply-post' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://root-post', {
            uri: 'at://root-post',
            cid: 'root-cid',
            record: { text: 'Root post' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
          ['at://parent-post', {
            uri: 'at://parent-post',
            cid: 'parent-cid',
            record: { text: 'Parent post' },
            author: { did: 'did:plc:author2' },
            indexedAt: '2024-01-01T01:00:00Z',
          }],
          ['at://reply-post', {
            uri: 'at://reply-post',
            cid: 'reply-cid',
            record: { text: 'Reply post' },
            author: { did: 'did:plc:author3' },
            indexedAt: '2024-01-01T02:00:00Z',
            reply: {
              root: { uri: 'at://root-post' },
              parent: { uri: 'at://parent-post' },
            },
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result).toBeDefined();
      expect(result!.reply).toBeDefined();
      expect(result!.reply.root.uri).toBe('at://root-post');
      expect(result!.reply.parent.uri).toBe('at://parent-post');
    });

    it('should return undefined reply when parent is missing', () => {
      const item: FeedItem = { post: { uri: 'at://reply-post' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://reply-post', {
            uri: 'at://reply-post',
            cid: 'reply-cid',
            record: { text: 'Reply post' },
            author: { did: 'did:plc:author3' },
            indexedAt: '2024-01-01T02:00:00Z',
            reply: {
              root: { uri: 'at://root-post' },
              parent: { uri: 'at://missing-parent' },
            },
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result).toBeDefined();
      expect(result!.reply).toBeUndefined();
    });

    it('should handle thread context', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            cid: 'cid1',
            record: { text: 'Hello' },
            author: { did: 'did:plc:author1' },
            indexedAt: '2024-01-01T00:00:00Z',
          }],
        ]),
        threadContexts: new Map([
          ['at://post1', {
            rootAuthorLikeUri: 'at://root-like',
          }],
        ]),
      });

      const result = views.feedViewPost(item, state);

      expect(result!.post.threadContext).toBeDefined();
      expect(result!.post.threadContext.rootAuthorLike).toBe('at://root-like');
    });
  });

  describe('feedItemBlocksAndMutes', () => {
    it('should return all false when no blocks or mutes', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            author: { did: 'did:plc:author1' },
          }],
        ]),
        profileViewers: new Map([
          ['did:plc:author1', {}],
        ]),
      });

      const result = views.feedItemBlocksAndMutes(item, state);

      expect(result.authorBlocked).toBe(false);
      expect(result.originatorBlocked).toBe(false);
      expect(result.authorMuted).toBe(false);
      expect(result.originatorMuted).toBe(false);
    });

    it('should detect author blocking', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            author: { did: 'did:plc:author1' },
          }],
        ]),
        profileViewers: new Map([
          ['did:plc:author1', { blocking: true }],
        ]),
      });

      const result = views.feedItemBlocksAndMutes(item, state);

      expect(result.authorBlocked).toBe(true);
    });

    it('should detect author muting', () => {
      const item: FeedItem = { post: { uri: 'at://post1' } };
      const state = createHydrationState({
        posts: new Map([
          ['at://post1', {
            uri: 'at://post1',
            author: { did: 'did:plc:author1' },
          }],
        ]),
        profileViewers: new Map([
          ['did:plc:author1', { muting: true }],
        ]),
      });

      const result = views.feedItemBlocksAndMutes(item, state);

      expect(result.authorMuted).toBe(true);
    });

    it('should handle missing post info gracefully', () => {
      const item: FeedItem = { post: { uri: 'at://missing' } };
      const state = createHydrationState();

      const result = views.feedItemBlocksAndMutes(item, state);

      expect(result.authorBlocked).toBe(false);
      expect(result.originatorBlocked).toBe(false);
      expect(result.authorMuted).toBe(false);
      expect(result.originatorMuted).toBe(false);
    });
  });

  describe('blockingByList', () => {
    it('should return false (not implemented)', () => {
      const relationship = {} as any;
      const state = createHydrationState();

      const result = views.blockingByList(relationship, state);

      expect(result).toBe(false);
    });
  });

  describe('blockedByList', () => {
    it('should return false (not implemented)', () => {
      const relationship = {} as any;
      const state = createHydrationState();

      const result = views.blockedByList(relationship, state);

      expect(result).toBe(false);
    });
  });
});
