import { describe, it, expect } from 'vitest';
import {
  FeedType,
  FILTER_TO_FEED_TYPE,
  FeedItemType,
  SelfThreadTracker,
  type FeedItem,
  type HydrationState,
} from '../../server/types/feed';

describe('Feed Types', () => {
  describe('FeedType enum', () => {
    it('should have POSTS_WITH_REPLIES', () => {
      expect(FeedType.POSTS_WITH_REPLIES).toBe('posts_with_replies');
    });

    it('should have POSTS_NO_REPLIES', () => {
      expect(FeedType.POSTS_NO_REPLIES).toBe('posts_no_replies');
    });

    it('should have POSTS_WITH_MEDIA', () => {
      expect(FeedType.POSTS_WITH_MEDIA).toBe('posts_with_media');
    });

    it('should have POSTS_AND_AUTHOR_THREADS', () => {
      expect(FeedType.POSTS_AND_AUTHOR_THREADS).toBe('posts_and_author_threads');
    });

    it('should have POSTS_WITH_VIDEO', () => {
      expect(FeedType.POSTS_WITH_VIDEO).toBe('posts_with_video');
    });
  });

  describe('FILTER_TO_FEED_TYPE', () => {
    it('should map posts_with_replies to undefined', () => {
      expect(FILTER_TO_FEED_TYPE.posts_with_replies).toBeUndefined();
    });

    it('should map posts_no_replies to POSTS_NO_REPLIES', () => {
      expect(FILTER_TO_FEED_TYPE.posts_no_replies).toBe(
        FeedType.POSTS_NO_REPLIES
      );
    });

    it('should map posts_with_media to POSTS_WITH_MEDIA', () => {
      expect(FILTER_TO_FEED_TYPE.posts_with_media).toBe(
        FeedType.POSTS_WITH_MEDIA
      );
    });

    it('should map posts_and_author_threads to POSTS_AND_AUTHOR_THREADS', () => {
      expect(FILTER_TO_FEED_TYPE.posts_and_author_threads).toBe(
        FeedType.POSTS_AND_AUTHOR_THREADS
      );
    });

    it('should map posts_with_video to POSTS_WITH_VIDEO', () => {
      expect(FILTER_TO_FEED_TYPE.posts_with_video).toBe(
        FeedType.POSTS_WITH_VIDEO
      );
    });
  });

  describe('FeedItemType enum', () => {
    it('should have POST', () => {
      expect(FeedItemType.POST).toBe('post');
    });

    it('should have REPOST', () => {
      expect(FeedItemType.REPOST).toBe('repost');
    });

    it('should have REPLY', () => {
      expect(FeedItemType.REPLY).toBe('reply');
    });
  });
});

describe('SelfThreadTracker', () => {
  const createFeedItem = (uri: string, isRepost = false): FeedItem => ({
    post: { uri },
    repost: isRepost ? { uri: `repost:${uri}` } : undefined,
  });

  const createHydration = (posts: Record<string, any>): HydrationState => ({
    posts: new Map(Object.entries(posts)),
  });

  describe('constructor', () => {
    it('should initialize with feed items', () => {
      const items: FeedItem[] = [
        createFeedItem('at://post1'),
        createFeedItem('at://post2'),
      ];
      const hydration = createHydration({});

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.feedUris.has('at://post1')).toBe(true);
      expect(tracker.feedUris.has('at://post2')).toBe(true);
    });

    it('should not include repost URIs in feedUris', () => {
      const items: FeedItem[] = [
        createFeedItem('at://post1'),
        createFeedItem('at://post2', true), // This is a repost
      ];
      const hydration = createHydration({});

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.feedUris.has('at://post1')).toBe(true);
      expect(tracker.feedUris.has('at://post2')).toBe(false);
    });

    it('should start with empty cache', () => {
      const items: FeedItem[] = [createFeedItem('at://post1')];
      const hydration = createHydration({});

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.cache.size).toBe(0);
    });
  });

  describe('ok method', () => {
    it('should return true for root posts in feed', () => {
      const items: FeedItem[] = [createFeedItem('at://post1')];
      const hydration = createHydration({
        'at://post1': { uri: 'at://post1', record: {} },
      });

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.ok('at://post1')).toBe(true);
    });

    it('should return false for posts not in feed', () => {
      const items: FeedItem[] = [createFeedItem('at://post1')];
      const hydration = createHydration({
        'at://post2': { uri: 'at://post2', record: {} },
      });

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.ok('at://post2')).toBe(false);
    });

    it('should return false for posts not in hydration', () => {
      const items: FeedItem[] = [createFeedItem('at://post1')];
      const hydration = createHydration({});

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.ok('at://post1')).toBe(false);
    });

    it('should cache results', () => {
      const items: FeedItem[] = [createFeedItem('at://post1')];
      const hydration = createHydration({
        'at://post1': { uri: 'at://post1', record: {} },
      });

      const tracker = new SelfThreadTracker(items, hydration);

      tracker.ok('at://post1');

      expect(tracker.cache.has('at://post1')).toBe(true);
      expect(tracker.cache.get('at://post1')).toBe(true);
    });

    it('should return cached result on subsequent calls', () => {
      const items: FeedItem[] = [createFeedItem('at://post1')];
      const hydration = createHydration({
        'at://post1': { uri: 'at://post1', record: {} },
      });

      const tracker = new SelfThreadTracker(items, hydration);

      const result1 = tracker.ok('at://post1');
      const result2 = tracker.ok('at://post1');

      expect(result1).toBe(result2);
    });

    it('should return true for reply to post that is in self-thread', () => {
      const items: FeedItem[] = [
        createFeedItem('at://root'),
        createFeedItem('at://reply'),
      ];
      const hydration = createHydration({
        'at://root': { uri: 'at://root', record: {} },
        'at://reply': {
          uri: 'at://reply',
          record: {
            reply: {
              parent: { uri: 'at://root' },
            },
          },
        },
      });

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.ok('at://reply')).toBe(true);
    });

    it('should return false for reply to post not in feed', () => {
      const items: FeedItem[] = [createFeedItem('at://reply')];
      const hydration = createHydration({
        'at://reply': {
          uri: 'at://reply',
          record: {
            reply: {
              parent: { uri: 'at://external-post' },
            },
          },
        },
      });

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.ok('at://reply')).toBe(false);
    });

    it('should handle loop detection', () => {
      const items: FeedItem[] = [
        createFeedItem('at://post1'),
        createFeedItem('at://post2'),
      ];
      // Create a circular reference
      const hydration = createHydration({
        'at://post1': {
          uri: 'at://post1',
          record: { reply: { parent: { uri: 'at://post2' } } },
        },
        'at://post2': {
          uri: 'at://post2',
          record: { reply: { parent: { uri: 'at://post1' } } },
        },
      });

      const tracker = new SelfThreadTracker(items, hydration);

      // Should not hang and should return false due to loop
      expect(tracker.ok('at://post1')).toBe(false);
    });

    it('should handle nested thread chains', () => {
      const items: FeedItem[] = [
        createFeedItem('at://root'),
        createFeedItem('at://reply1'),
        createFeedItem('at://reply2'),
      ];
      const hydration = createHydration({
        'at://root': { uri: 'at://root', record: {} },
        'at://reply1': {
          uri: 'at://reply1',
          record: { reply: { parent: { uri: 'at://root' } } },
        },
        'at://reply2': {
          uri: 'at://reply2',
          record: { reply: { parent: { uri: 'at://reply1' } } },
        },
      });

      const tracker = new SelfThreadTracker(items, hydration);

      expect(tracker.ok('at://root')).toBe(true);
      expect(tracker.ok('at://reply1')).toBe(true);
      expect(tracker.ok('at://reply2')).toBe(true);
    });
  });
});
