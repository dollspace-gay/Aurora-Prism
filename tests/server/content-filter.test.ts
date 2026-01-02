import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Post, UserSettings, Label } from '@shared/schema';

// Mock the labelService before importing ContentFilterService
vi.mock('../../server/services/label', () => ({
  labelService: {
    getActiveLabelsForSubjects: vi.fn().mockResolvedValue(new Map()),
  },
}));

import { ContentFilterService } from '../../server/services/content-filter';
import { labelService } from '../../server/services/label';

// Helper to create mock posts
function createMockPost(overrides: Partial<Post> = {}): Post {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/123',
    cid: 'bafyreiabc123',
    authorDid: 'did:plc:testauthor',
    text: 'This is a test post',
    langs: ['en'],
    parentUri: null,
    parentCid: null,
    rootUri: null,
    rootCid: null,
    embed: null,
    facets: null,
    violatesThreadGate: false,
    violatesEmbeddingRules: false,
    hasThreadGate: false,
    hasPostGate: false,
    tags: [],
    searchVector: null,
    createdAt: new Date(),
    indexedAt: new Date(),
    commitTime: null,
    commitSeq: null,
    commitRev: null,
    ...overrides,
  };
}

// Helper to create mock user settings
function createMockSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    userDid: 'did:plc:viewer',
    blockedKeywords: [],
    mutedUsers: [],
    customLists: [],
    feedPreferences: {},
    dataCollectionForbidden: false,
    lastBackfillAt: null,
    lastLikedPostsBackfill: null,
    lastFollowsBackfill: null,
    lastFeedsBackfill: null,
    lastNotificationsBackfill: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Helper to create mock labels
function createMockLabel(overrides: Partial<Label> = {}): Label {
  return {
    uri: 'at://did:plc:labeler/com.atproto.label/123',
    src: 'did:plc:labeler',
    subject: 'at://did:plc:test/app.bsky.feed.post/123',
    val: 'spam',
    neg: false,
    createdAt: new Date(),
    indexedAt: new Date(),
    ...overrides,
  };
}

describe('ContentFilterService', () => {
  let contentFilter: ContentFilterService;

  beforeEach(() => {
    vi.clearAllMocks();
    contentFilter = new ContentFilterService();
  });

  describe('filterPost', () => {
    it('should not filter when settings is null', () => {
      const post = createMockPost();
      const result = contentFilter.filterPost(post, null);

      expect(result.filtered).toBe(false);
    });

    it('should filter posts from muted users', () => {
      const post = createMockPost({ authorDid: 'did:plc:muteduser' });
      const settings = createMockSettings({
        mutedUsers: ['did:plc:muteduser', 'did:plc:another'],
      });

      const result = contentFilter.filterPost(post, settings);

      expect(result.filtered).toBe(true);
      expect(result.reason).toBe('Author is muted');
    });

    it('should not filter posts from non-muted users', () => {
      const post = createMockPost({ authorDid: 'did:plc:normaluser' });
      const settings = createMockSettings({
        mutedUsers: ['did:plc:muteduser'],
      });

      const result = contentFilter.filterPost(post, settings);

      expect(result.filtered).toBe(false);
    });

    it('should filter posts containing blocked keywords', () => {
      const post = createMockPost({ text: 'This post contains SPAM content' });
      const settings = createMockSettings({
        blockedKeywords: ['spam', 'scam'],
      });

      const result = contentFilter.filterPost(post, settings);

      expect(result.filtered).toBe(true);
      expect(result.reason).toBe('Contains blocked keyword: spam');
    });

    it('should filter case-insensitively', () => {
      const post = createMockPost({ text: 'This has BLOCKED word' });
      const settings = createMockSettings({
        blockedKeywords: ['blocked'],
      });

      const result = contentFilter.filterPost(post, settings);

      expect(result.filtered).toBe(true);
    });

    it('should not filter posts without blocked keywords', () => {
      const post = createMockPost({ text: 'This is a clean post' });
      const settings = createMockSettings({
        blockedKeywords: ['spam', 'scam'],
      });

      const result = contentFilter.filterPost(post, settings);

      expect(result.filtered).toBe(false);
    });

    it('should check muted users before keywords', () => {
      const post = createMockPost({
        authorDid: 'did:plc:muteduser',
        text: 'Contains spam keyword',
      });
      const settings = createMockSettings({
        mutedUsers: ['did:plc:muteduser'],
        blockedKeywords: ['spam'],
      });

      const result = contentFilter.filterPost(post, settings);

      expect(result.filtered).toBe(true);
      expect(result.reason).toBe('Author is muted');
    });
  });

  describe('filterPosts', () => {
    it('should return all posts when settings is null', () => {
      const posts = [
        createMockPost({ uri: 'post1' }),
        createMockPost({ uri: 'post2' }),
        createMockPost({ uri: 'post3' }),
      ];

      const result = contentFilter.filterPosts(posts, null);

      expect(result.length).toBe(3);
    });

    it('should filter multiple posts', () => {
      const posts = [
        createMockPost({ uri: 'post1', authorDid: 'did:plc:user1' }),
        createMockPost({ uri: 'post2', authorDid: 'did:plc:muteduser' }),
        createMockPost({ uri: 'post3', text: 'Contains spam' }),
        createMockPost({ uri: 'post4', authorDid: 'did:plc:user2' }),
      ];
      const settings = createMockSettings({
        mutedUsers: ['did:plc:muteduser'],
        blockedKeywords: ['spam'],
      });

      const result = contentFilter.filterPosts(posts, settings);

      expect(result.length).toBe(2);
      expect(result.map((p) => p.uri)).toEqual(['post1', 'post4']);
    });

    it('should return empty array for empty input', () => {
      const settings = createMockSettings();
      const result = contentFilter.filterPosts([], settings);
      expect(result).toEqual([]);
    });
  });

  describe('filterPostWithLabels', () => {
    it('should apply basic filters first', async () => {
      const post = createMockPost({ authorDid: 'did:plc:muteduser' });
      const settings = createMockSettings({
        mutedUsers: ['did:plc:muteduser'],
      });

      const result = await contentFilter.filterPostWithLabels(post, settings);

      expect(result.filtered).toBe(true);
      expect(result.reason).toBe('Author is muted');
      // Should not call label service since basic filter matched
      expect(labelService.getActiveLabelsForSubjects).not.toHaveBeenCalled();
    });

    it('should check labels when basic filters pass', async () => {
      const post = createMockPost();
      const settings = createMockSettings();

      vi.mocked(labelService.getActiveLabelsForSubjects).mockResolvedValue(
        new Map([[post.uri, [createMockLabel({ val: 'spam' })]]])
      );

      const result = await contentFilter.filterPostWithLabels(post, settings);

      expect(result.filtered).toBe(true);
      expect(result.reason).toBe('Labeled as spam');
      expect(result.labels).toHaveLength(1);
    });

    it('should filter by nsfw label', async () => {
      const post = createMockPost();
      const settings = createMockSettings();

      vi.mocked(labelService.getActiveLabelsForSubjects).mockResolvedValue(
        new Map([[post.uri, [createMockLabel({ val: 'nsfw' })]]])
      );

      const result = await contentFilter.filterPostWithLabels(post, settings);

      expect(result.filtered).toBe(true);
      expect(result.reason).toBe('Labeled as nsfw');
    });

    it('should filter by author labels', async () => {
      const post = createMockPost();
      const settings = createMockSettings();

      vi.mocked(labelService.getActiveLabelsForSubjects).mockResolvedValue(
        new Map([
          [post.authorDid, [createMockLabel({ val: 'spam', subject: post.authorDid })]],
        ])
      );

      const result = await contentFilter.filterPostWithLabels(post, settings);

      expect(result.filtered).toBe(true);
      expect(result.reason).toBe('Labeled as spam');
    });

    it('should return labels without filtering for non-hide labels', async () => {
      const post = createMockPost();
      const settings = createMockSettings();
      const infoLabel = createMockLabel({ val: 'informational' });

      vi.mocked(labelService.getActiveLabelsForSubjects).mockResolvedValue(
        new Map([[post.uri, [infoLabel]]])
      );

      const result = await contentFilter.filterPostWithLabels(post, settings);

      expect(result.filtered).toBe(false);
      expect(result.labels).toEqual([infoLabel]);
    });

    it('should not filter when no labels present', async () => {
      const post = createMockPost();
      const settings = createMockSettings();

      vi.mocked(labelService.getActiveLabelsForSubjects).mockResolvedValue(
        new Map()
      );

      const result = await contentFilter.filterPostWithLabels(post, settings);

      expect(result.filtered).toBe(false);
      expect(result.labels).toBeUndefined();
    });
  });

  describe('filterPostsWithLabels', () => {
    it('should return all posts for empty array', async () => {
      const result = await contentFilter.filterPostsWithLabels([], null);
      expect(result).toEqual([]);
    });

    it('should batch fetch labels for all posts', async () => {
      const posts = [
        createMockPost({ uri: 'post1', authorDid: 'did:plc:user1' }),
        createMockPost({ uri: 'post2', authorDid: 'did:plc:user2' }),
      ];
      const settings = createMockSettings();

      vi.mocked(labelService.getActiveLabelsForSubjects).mockResolvedValue(
        new Map([['post1', [createMockLabel({ val: 'spam', subject: 'post1' })]]])
      );

      const result = await contentFilter.filterPostsWithLabels(posts, settings);

      expect(labelService.getActiveLabelsForSubjects).toHaveBeenCalledTimes(1);
      expect(result.length).toBe(1);
      expect(result[0].uri).toBe('post2');
    });
  });

  describe('filterPostsWithRules', () => {
    it('should apply keyword rules', () => {
      const posts = [
        createMockPost({ uri: 'post1', text: 'Normal post' }),
        createMockPost({ uri: 'post2', text: 'Contains forbidden word' }),
      ];
      const settings = createMockSettings();

      const rules = [
        contentFilter.createRule('keyword', 'hide', 'forbidden'),
      ];

      const result = contentFilter.filterPostsWithRules(posts, settings, rules);

      expect(result.length).toBe(1);
      expect(result[0].uri).toBe('post1');
    });

    it('should apply user rules', () => {
      const posts = [
        createMockPost({ uri: 'post1', authorDid: 'did:plc:user1' }),
        createMockPost({ uri: 'post2', authorDid: 'did:plc:blocked' }),
      ];
      const settings = createMockSettings();

      const rules = [
        contentFilter.createRule('user', 'hide', 'did:plc:blocked'),
      ];

      const result = contentFilter.filterPostsWithRules(posts, settings, rules);

      expect(result.length).toBe(1);
      expect(result[0].uri).toBe('post1');
    });

    it('should apply custom function rules with warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const posts = [
        createMockPost({ uri: 'post1', text: 'Short' }),
        createMockPost({ uri: 'post2', text: 'This is a much longer post' }),
      ];
      const settings = createMockSettings();

      const rules = [
        contentFilter.createRule('custom', 'hide', (post: Post) => post.text.length > 20),
      ];

      const result = contentFilter.filterPostsWithRules(posts, settings, rules);

      expect(result.length).toBe(1);
      expect(result[0].uri).toBe('post1');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle errors in custom function rules gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const posts = [createMockPost({ uri: 'post1' })];
      const settings = createMockSettings();

      const rules = [
        contentFilter.createRule('custom', 'hide', () => {
          throw new Error('Test error');
        }),
      ];

      const result = contentFilter.filterPostsWithRules(posts, settings, rules);

      // Should not filter on error (fail safe)
      expect(result.length).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should return posts unchanged with no rules', () => {
      const posts = [
        createMockPost({ uri: 'post1' }),
        createMockPost({ uri: 'post2' }),
      ];
      const settings = createMockSettings();

      const result = contentFilter.filterPostsWithRules(posts, settings);

      expect(result.length).toBe(2);
    });
  });

  describe('getFilterStats', () => {
    it('should return zeroes when settings is null', () => {
      const posts = [createMockPost(), createMockPost()];
      const stats = contentFilter.getFilterStats(posts, null);

      expect(stats.total).toBe(2);
      expect(stats.filtered).toBe(0);
      expect(stats.byKeyword).toBe(0);
      expect(stats.byMutedUser).toBe(0);
      expect(stats.visible).toBe(2);
    });

    it('should count filters correctly', () => {
      const posts = [
        createMockPost({ uri: 'post1', authorDid: 'did:plc:muteduser' }),
        createMockPost({ uri: 'post2', text: 'Contains spam' }),
        createMockPost({ uri: 'post3', authorDid: 'did:plc:muteduser', text: 'spam' }),
        createMockPost({ uri: 'post4' }),
      ];
      const settings = createMockSettings({
        mutedUsers: ['did:plc:muteduser'],
        blockedKeywords: ['spam'],
      });

      const stats = contentFilter.getFilterStats(posts, settings);

      expect(stats.total).toBe(4);
      expect(stats.filtered).toBe(3);
      expect(stats.byMutedUser).toBe(2); // post1 and post3 (checked first)
      expect(stats.byKeyword).toBe(1); // post2
      expect(stats.visible).toBe(1);
    });
  });

  describe('getFilterStatsWithLabels', () => {
    it('should return zeroes for empty array', async () => {
      const stats = await contentFilter.getFilterStatsWithLabels([], null);

      expect(stats.total).toBe(0);
      expect(stats.filtered).toBe(0);
      expect(stats.byLabel).toBe(0);
      expect(stats.visible).toBe(0);
    });

    it('should count label filters', async () => {
      const posts = [
        createMockPost({ uri: 'post1' }),
        createMockPost({ uri: 'post2' }),
        createMockPost({ uri: 'post3' }),
      ];
      const settings = createMockSettings();

      vi.mocked(labelService.getActiveLabelsForSubjects).mockResolvedValue(
        new Map([['post2', [createMockLabel({ val: 'spam', subject: 'post2' })]]])
      );

      const stats = await contentFilter.getFilterStatsWithLabels(posts, settings);

      expect(stats.total).toBe(3);
      expect(stats.filtered).toBe(1);
      expect(stats.byLabel).toBe(1);
      expect(stats.visible).toBe(2);
    });
  });

  describe('wouldFilter', () => {
    it('should return same result as filterPost', () => {
      const post = createMockPost({ authorDid: 'did:plc:muteduser' });
      const settings = createMockSettings({
        mutedUsers: ['did:plc:muteduser'],
      });

      const wouldResult = contentFilter.wouldFilter(post, settings);
      const filterResult = contentFilter.filterPost(post, settings);

      expect(wouldResult).toEqual(filterResult);
    });
  });

  describe('createRule', () => {
    it('should create keyword rule', () => {
      const rule = contentFilter.createRule('keyword', 'hide', 'test');

      expect(rule.type).toBe('keyword');
      expect(rule.action).toBe('hide');
      expect(rule.value).toBe('test');
    });

    it('should create user rule', () => {
      const rule = contentFilter.createRule('user', 'warn', 'did:plc:user');

      expect(rule.type).toBe('user');
      expect(rule.action).toBe('warn');
      expect(rule.value).toBe('did:plc:user');
    });

    it('should create custom rule with function', () => {
      const fn = (post: Post) => post.text.length > 100;
      const rule = contentFilter.createRule('custom', 'hide', fn);

      expect(rule.type).toBe('custom');
      expect(rule.action).toBe('hide');
      expect(rule.value).toBe(fn);
    });
  });

  describe('sanitizeKeyword', () => {
    it('should trim whitespace', () => {
      expect(contentFilter.sanitizeKeyword('  test  ')).toBe('test');
    });

    it('should convert to lowercase', () => {
      expect(contentFilter.sanitizeKeyword('TEST')).toBe('test');
      expect(contentFilter.sanitizeKeyword('TeSt')).toBe('test');
    });

    it('should handle mixed case and whitespace', () => {
      expect(contentFilter.sanitizeKeyword('  HELLO World  ')).toBe('hello world');
    });
  });

  describe('isValidKeyword', () => {
    it('should accept valid keywords', () => {
      expect(contentFilter.isValidKeyword('test')).toBe(true);
      expect(contentFilter.isValidKeyword('hello world')).toBe(true);
      expect(contentFilter.isValidKeyword('a')).toBe(true);
    });

    it('should reject empty keywords', () => {
      expect(contentFilter.isValidKeyword('')).toBe(false);
      expect(contentFilter.isValidKeyword('   ')).toBe(false);
    });

    it('should reject keywords over 100 characters', () => {
      expect(contentFilter.isValidKeyword('a'.repeat(100))).toBe(true);
      expect(contentFilter.isValidKeyword('a'.repeat(101))).toBe(false);
    });
  });
});
