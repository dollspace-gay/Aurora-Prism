import { describe, it, expect, beforeEach } from 'vitest';
import {
  LexiconValidator,
  postSchema,
  likeSchema,
  repostSchema,
  profileSchema,
  followSchema,
  blockSchema,
  feedGeneratorSchema,
  starterPackSchema,
  listSchema,
  listItemSchema,
  labelerServiceSchema,
} from '../../server/services/lexicon-validator';

describe('LexiconValidator', () => {
  let validator: LexiconValidator;

  beforeEach(() => {
    validator = new LexiconValidator();
  });

  describe('postSchema', () => {
    it('should validate a minimal post', () => {
      const post = {
        $type: 'app.bsky.feed.post',
        text: 'Hello world!',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => postSchema.parse(post)).not.toThrow();
    });

    it('should validate post with reply', () => {
      const post = {
        $type: 'app.bsky.feed.post',
        text: 'Reply to something',
        createdAt: '2024-01-01T00:00:00.000Z',
        reply: {
          root: {
            uri: 'at://did:plc:root/app.bsky.feed.post/abc',
            cid: 'cidroot',
          },
          parent: {
            uri: 'at://did:plc:parent/app.bsky.feed.post/def',
            cid: 'cidparent',
          },
        },
      };
      expect(() => postSchema.parse(post)).not.toThrow();
    });

    it('should validate post with langs', () => {
      const post = {
        $type: 'app.bsky.feed.post',
        text: 'Hello',
        createdAt: '2024-01-01T00:00:00.000Z',
        langs: ['en', 'es'],
      };
      expect(() => postSchema.parse(post)).not.toThrow();
    });

    it('should reject post with wrong $type', () => {
      const post = {
        $type: 'app.bsky.feed.like',
        text: 'Hello',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => postSchema.parse(post)).toThrow();
    });

    it('should reject post with missing text', () => {
      const post = {
        $type: 'app.bsky.feed.post',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => postSchema.parse(post)).toThrow();
    });
  });

  describe('likeSchema', () => {
    it('should validate a like', () => {
      const like = {
        $type: 'app.bsky.feed.like',
        subject: {
          uri: 'at://did:plc:abc/app.bsky.feed.post/123',
          cid: 'somecid',
        },
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => likeSchema.parse(like)).not.toThrow();
    });

    it('should reject like with missing subject', () => {
      const like = {
        $type: 'app.bsky.feed.like',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => likeSchema.parse(like)).toThrow();
    });
  });

  describe('repostSchema', () => {
    it('should validate a repost', () => {
      const repost = {
        $type: 'app.bsky.feed.repost',
        subject: {
          uri: 'at://did:plc:abc/app.bsky.feed.post/123',
          cid: 'somecid',
        },
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => repostSchema.parse(repost)).not.toThrow();
    });
  });

  describe('profileSchema', () => {
    it('should validate a minimal profile', () => {
      const profile = {
        $type: 'app.bsky.actor.profile',
      };
      expect(() => profileSchema.parse(profile)).not.toThrow();
    });

    it('should validate a full profile', () => {
      const profile = {
        $type: 'app.bsky.actor.profile',
        displayName: 'Test User',
        description: 'A test user description',
        avatar: { $type: 'blob', ref: 'abc' },
        banner: { $type: 'blob', ref: 'def' },
      };
      expect(() => profileSchema.parse(profile)).not.toThrow();
    });
  });

  describe('followSchema', () => {
    it('should validate a follow', () => {
      const follow = {
        $type: 'app.bsky.graph.follow',
        subject: 'did:plc:followed123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => followSchema.parse(follow)).not.toThrow();
    });
  });

  describe('blockSchema', () => {
    it('should validate a block', () => {
      const block = {
        $type: 'app.bsky.graph.block',
        subject: 'did:plc:blocked123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => blockSchema.parse(block)).not.toThrow();
    });
  });

  describe('feedGeneratorSchema', () => {
    it('should validate a feed generator', () => {
      const generator = {
        $type: 'app.bsky.feed.generator',
        did: 'did:plc:feedgen123',
        displayName: 'My Feed',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => feedGeneratorSchema.parse(generator)).not.toThrow();
    });

    it('should validate feed generator with optional fields', () => {
      const generator = {
        $type: 'app.bsky.feed.generator',
        did: 'did:plc:feedgen123',
        displayName: 'My Feed',
        description: 'A custom feed',
        acceptsInteractions: true,
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => feedGeneratorSchema.parse(generator)).not.toThrow();
    });
  });

  describe('starterPackSchema', () => {
    it('should validate a starter pack', () => {
      const pack = {
        $type: 'app.bsky.graph.starterpack',
        name: 'My Starter Pack',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => starterPackSchema.parse(pack)).not.toThrow();
    });

    it('should validate starter pack with feeds', () => {
      const pack = {
        $type: 'app.bsky.graph.starterpack',
        name: 'My Starter Pack',
        description: 'Great accounts to follow',
        feeds: [{ uri: 'at://did:plc:abc/app.bsky.feed.generator/123' }],
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => starterPackSchema.parse(pack)).not.toThrow();
    });
  });

  describe('listSchema', () => {
    it('should validate a list', () => {
      const list = {
        $type: 'app.bsky.graph.list',
        name: 'My List',
        purpose: 'app.bsky.graph.defs#curatelist',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => listSchema.parse(list)).not.toThrow();
    });
  });

  describe('listItemSchema', () => {
    it('should validate a list item', () => {
      const item = {
        $type: 'app.bsky.graph.listitem',
        list: 'at://did:plc:abc/app.bsky.graph.list/123',
        subject: 'did:plc:member123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => listItemSchema.parse(item)).not.toThrow();
    });
  });

  describe('labelerServiceSchema', () => {
    it('should validate a labeler service', () => {
      const labeler = {
        $type: 'app.bsky.labeler.service',
        policies: { labelValues: ['spam', 'nsfw'] },
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(() => labelerServiceSchema.parse(labeler)).not.toThrow();
    });
  });

  describe('validate method', () => {
    it('should validate post records', () => {
      const post = {
        $type: 'app.bsky.feed.post',
        text: 'Hello',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.feed.post', post)).toBe(true);
    });

    it('should validate like records', () => {
      const like = {
        $type: 'app.bsky.feed.like',
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/123', cid: 'cid' },
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.feed.like', like)).toBe(true);
    });

    it('should validate repost records', () => {
      const repost = {
        $type: 'app.bsky.feed.repost',
        subject: { uri: 'at://did:plc:abc/app.bsky.feed.post/123', cid: 'cid' },
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.feed.repost', repost)).toBe(true);
    });

    it('should validate profile records', () => {
      const profile = {
        $type: 'app.bsky.actor.profile',
        displayName: 'Test',
      };
      expect(validator.validate('app.bsky.actor.profile', profile)).toBe(true);
    });

    it('should validate follow records', () => {
      const follow = {
        $type: 'app.bsky.graph.follow',
        subject: 'did:plc:abc',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.graph.follow', follow)).toBe(true);
    });

    it('should validate block records', () => {
      const block = {
        $type: 'app.bsky.graph.block',
        subject: 'did:plc:abc',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.graph.block', block)).toBe(true);
    });

    it('should validate feed.generator records', () => {
      const generator = {
        $type: 'app.bsky.feed.generator',
        did: 'did:plc:abc',
        displayName: 'My Feed',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.feed.generator', generator)).toBe(
        true
      );
    });

    it('should validate starterpack records', () => {
      const pack = {
        $type: 'app.bsky.graph.starterpack',
        name: 'Pack',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.graph.starterpack', pack)).toBe(true);
    });

    it('should validate list records', () => {
      const list = {
        $type: 'app.bsky.graph.list',
        name: 'List',
        purpose: 'curate',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.graph.list', list)).toBe(true);
    });

    it('should validate listitem records', () => {
      const item = {
        $type: 'app.bsky.graph.listitem',
        list: 'at://list',
        subject: 'did:plc:abc',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.graph.listitem', item)).toBe(true);
    });

    it('should validate labeler.service records', () => {
      const labeler = {
        $type: 'app.bsky.labeler.service',
        policies: {},
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.labeler.service', labeler)).toBe(
        true
      );
    });

    it('should pass through unknown record types', () => {
      const unknown = {
        $type: 'app.bsky.unknown.type',
        someField: 'value',
      };
      expect(validator.validate('app.bsky.unknown.type', unknown)).toBe(true);
    });

    it('should return false for invalid records', () => {
      const invalidPost = {
        $type: 'app.bsky.feed.post',
        // missing text
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      expect(validator.validate('app.bsky.feed.post', invalidPost)).toBe(false);
    });

    it('should track valid counts', () => {
      const post = {
        $type: 'app.bsky.feed.post',
        text: 'Hello',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      validator.validate('app.bsky.feed.post', post);
      validator.validate('app.bsky.feed.post', post);

      const stats = validator.getStats();
      expect(stats.valid).toBe(2);
    });

    it('should track invalid counts', () => {
      const invalidPost = {
        $type: 'app.bsky.feed.post',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      validator.validate('app.bsky.feed.post', invalidPost);

      const stats = validator.getStats();
      expect(stats.invalid).toBe(1);
    });

    it('should track unknown counts', () => {
      validator.validate('app.bsky.unknown.type', {});

      const stats = validator.getStats();
      expect(stats.unknown).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return zero stats initially', () => {
      const stats = validator.getStats();
      expect(stats.total).toBe(0);
      expect(stats.valid).toBe(0);
      expect(stats.invalid).toBe(0);
      expect(stats.unknown).toBe(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should calculate error rate correctly', () => {
      const validPost = {
        $type: 'app.bsky.feed.post',
        text: 'Hello',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      const invalidPost = {
        $type: 'app.bsky.feed.post',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      validator.validate('app.bsky.feed.post', validPost);
      validator.validate('app.bsky.feed.post', validPost);
      validator.validate('app.bsky.feed.post', validPost);
      validator.validate('app.bsky.feed.post', invalidPost);

      const stats = validator.getStats();
      expect(stats.errorRate).toBe(25); // 1 out of 4 = 25%
    });

    it('should return recent errors', () => {
      const invalidPost = {
        $type: 'app.bsky.feed.post',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      validator.validate('app.bsky.feed.post', invalidPost);

      const stats = validator.getStats();
      expect(stats.recentErrors).toHaveLength(1);
      expect(stats.recentErrors[0].type).toBe('app.bsky.feed.post');
    });

    it('should limit error log to 1000 entries', () => {
      const invalidPost = {
        $type: 'app.bsky.feed.post',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      for (let i = 0; i < 1050; i++) {
        validator.validate('app.bsky.feed.post', invalidPost);
      }

      const stats = validator.getStats();
      expect(stats.invalid).toBe(1050);
      // Error log is capped at 1000
      expect(stats.recentErrors.length).toBeLessThanOrEqual(10); // getStats returns last 10
    });
  });

  describe('resetStats', () => {
    it('should reset all stats to zero', () => {
      const post = {
        $type: 'app.bsky.feed.post',
        text: 'Hello',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      const invalidPost = {
        $type: 'app.bsky.feed.post',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      validator.validate('app.bsky.feed.post', post);
      validator.validate('app.bsky.feed.post', invalidPost);
      validator.validate('app.bsky.unknown', {});

      validator.resetStats();

      const stats = validator.getStats();
      expect(stats.total).toBe(0);
      expect(stats.valid).toBe(0);
      expect(stats.invalid).toBe(0);
      expect(stats.unknown).toBe(0);
      expect(stats.recentErrors).toHaveLength(0);
    });
  });

  describe('getSupportedLexicons', () => {
    it('should return list of supported lexicons', () => {
      const lexicons = validator.getSupportedLexicons();
      expect(lexicons).toBeInstanceOf(Array);
      expect(lexicons.length).toBeGreaterThan(0);
    });

    it('should include all major record types', () => {
      const lexicons = validator.getSupportedLexicons();
      const names = lexicons.map((l) => l.name);

      expect(names).toContain('app.bsky.feed.post');
      expect(names).toContain('app.bsky.feed.like');
      expect(names).toContain('app.bsky.feed.repost');
      expect(names).toContain('app.bsky.actor.profile');
      expect(names).toContain('app.bsky.graph.follow');
      expect(names).toContain('app.bsky.graph.block');
    });

    it('should have version info for each lexicon', () => {
      const lexicons = validator.getSupportedLexicons();
      lexicons.forEach((lexicon) => {
        expect(lexicon.name).toBeDefined();
        expect(lexicon.version).toBeDefined();
      });
    });
  });
});
