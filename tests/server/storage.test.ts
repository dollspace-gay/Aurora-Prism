import { describe, it, expect, beforeEach } from 'vitest';
import { createMockStorage } from '../helpers/test-database';

describe('Storage Operations', () => {
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
  });

  afterEach(() => {
    mockStorage._clear();
  });

  describe('User Operations', () => {
    const testUser = {
      did: 'did:plc:testuser123456789012',
      handle: 'testuser.bsky.social',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.jpg',
      description: 'A test user',
      indexedAt: new Date(),
    };

    it('should create and retrieve a user', () => {
      mockStorage.upsertUser(testUser);

      const retrieved = mockStorage.getUser(testUser.did);
      expect(retrieved).toEqual(testUser);
      expect(mockStorage.upsertUser).toHaveBeenCalledWith(testUser);
    });

    it('should retrieve user by handle', () => {
      mockStorage.upsertUser(testUser);

      const retrieved = mockStorage.getUserByHandle(testUser.handle);
      expect(retrieved).toEqual(testUser);
    });

    it('should return undefined for non-existent user', () => {
      const retrieved = mockStorage.getUser('did:plc:nonexistent');
      expect(retrieved).toBeUndefined();
    });

    it('should update existing user', () => {
      mockStorage.upsertUser(testUser);

      const updatedUser = { ...testUser, displayName: 'Updated Name' };
      mockStorage.upsertUser(updatedUser);

      const retrieved = mockStorage.getUser(testUser.did);
      expect(retrieved?.displayName).toBe('Updated Name');
    });

    it('should store multiple users', () => {
      const user1 = {
        ...testUser,
        did: 'did:plc:user1',
        handle: 'user1.bsky.social',
      };
      const user2 = {
        ...testUser,
        did: 'did:plc:user2',
        handle: 'user2.bsky.social',
      };

      mockStorage.upsertUser(user1);
      mockStorage.upsertUser(user2);

      expect(mockStorage._users.size).toBe(2);
      expect(mockStorage.getUser('did:plc:user1')).toEqual(user1);
      expect(mockStorage.getUser('did:plc:user2')).toEqual(user2);
    });
  });

  describe('Post Operations', () => {
    const testPost = {
      uri: 'at://did:plc:testuser/app.bsky.feed.post/3k123abc',
      cid: 'bafyreia...',
      authorDid: 'did:plc:testuser',
      text: 'Hello, world!',
      replyParent: null,
      replyRoot: null,
      createdAt: new Date(),
      indexedAt: new Date(),
    };

    it('should create and retrieve a post', () => {
      mockStorage.upsertPost(testPost);

      const retrieved = mockStorage.getPost(testPost.uri);
      expect(retrieved).toEqual(testPost);
    });

    it('should delete a post', () => {
      mockStorage.upsertPost(testPost);
      mockStorage.deletePost(testPost.uri);

      expect(mockStorage._posts.has(testPost.uri)).toBe(false);
    });

    it('should return undefined for non-existent post', () => {
      const retrieved = mockStorage.getPost('at://nonexistent');
      expect(retrieved).toBeUndefined();
    });

    it('should handle reply posts', () => {
      const replyPost = {
        ...testPost,
        uri: 'at://did:plc:testuser/app.bsky.feed.post/reply123',
        replyParent: testPost.uri,
        replyRoot: testPost.uri,
        text: 'This is a reply',
      };

      mockStorage.upsertPost(testPost);
      mockStorage.upsertPost(replyPost);

      const retrieved = mockStorage.getPost(replyPost.uri);
      expect(retrieved?.replyParent).toBe(testPost.uri);
      expect(retrieved?.replyRoot).toBe(testPost.uri);
    });
  });

  describe('Like Operations', () => {
    const testLike = {
      uri: 'at://did:plc:testuser/app.bsky.feed.like/3k123abc',
      userDid: 'did:plc:testuser',
      subjectUri: 'at://did:plc:author/app.bsky.feed.post/xyz',
      subjectCid: 'bafyreia...',
      createdAt: new Date(),
    };

    it('should create and retrieve a like', () => {
      mockStorage.upsertLike(testLike);

      const retrieved = mockStorage.getLike(testLike.uri);
      expect(retrieved).toEqual(testLike);
    });

    it('should delete a like', () => {
      mockStorage.upsertLike(testLike);
      mockStorage.deleteLike(testLike.uri);

      expect(mockStorage._likes.has(testLike.uri)).toBe(false);
    });

    it('should track multiple likes on different posts', () => {
      const like1 = { ...testLike };
      const like2 = {
        ...testLike,
        uri: 'at://did:plc:testuser/app.bsky.feed.like/xyz789',
        subjectUri: 'at://did:plc:author/app.bsky.feed.post/another',
      };

      mockStorage.upsertLike(like1);
      mockStorage.upsertLike(like2);

      expect(mockStorage._likes.size).toBe(2);
    });
  });

  describe('Repost Operations', () => {
    const testRepost = {
      uri: 'at://did:plc:testuser/app.bsky.feed.repost/3k123abc',
      userDid: 'did:plc:testuser',
      subjectUri: 'at://did:plc:author/app.bsky.feed.post/xyz',
      subjectCid: 'bafyreia...',
      createdAt: new Date(),
    };

    it('should create and retrieve a repost', () => {
      mockStorage.upsertRepost(testRepost);

      const retrieved = mockStorage.getRepost(testRepost.uri);
      expect(retrieved).toEqual(testRepost);
    });

    it('should delete a repost', () => {
      mockStorage.upsertRepost(testRepost);
      mockStorage.deleteRepost(testRepost.uri);

      expect(mockStorage._reposts.has(testRepost.uri)).toBe(false);
    });
  });

  describe('Follow Operations', () => {
    const testFollow = {
      uri: 'at://did:plc:follower/app.bsky.graph.follow/3k123abc',
      followerDid: 'did:plc:follower',
      followingDid: 'did:plc:following',
      createdAt: new Date(),
    };

    it('should create and retrieve a follow', () => {
      mockStorage.upsertFollow(testFollow);

      const retrieved = mockStorage.getFollow(testFollow.uri);
      expect(retrieved).toEqual(testFollow);
    });

    it('should delete a follow', () => {
      mockStorage.upsertFollow(testFollow);
      mockStorage.deleteFollow(testFollow.uri);

      expect(mockStorage._follows.has(testFollow.uri)).toBe(false);
    });

    it('should track mutual follows', () => {
      const followA = testFollow;
      const followB = {
        uri: 'at://did:plc:following/app.bsky.graph.follow/xyz789',
        followerDid: 'did:plc:following',
        followingDid: 'did:plc:follower',
        createdAt: new Date(),
      };

      mockStorage.upsertFollow(followA);
      mockStorage.upsertFollow(followB);

      expect(mockStorage._follows.size).toBe(2);
    });
  });

  describe('Block Operations', () => {
    const testBlock = {
      uri: 'at://did:plc:blocker/app.bsky.graph.block/3k123abc',
      blockerDid: 'did:plc:blocker',
      blockedDid: 'did:plc:blocked',
      createdAt: new Date(),
    };

    it('should create and retrieve a block', () => {
      mockStorage.upsertBlock(testBlock);

      const retrieved = mockStorage.getBlock(testBlock.uri);
      expect(retrieved).toEqual(testBlock);
    });

    it('should delete a block', () => {
      mockStorage.upsertBlock(testBlock);
      mockStorage.deleteBlock(testBlock.uri);

      expect(mockStorage._blocks.has(testBlock.uri)).toBe(false);
    });
  });

  describe('Mute Operations', () => {
    const testMute = {
      uri: 'at://did:plc:muter/app.bsky.graph.mute/3k123abc',
      actorDid: 'did:plc:muter',
      targetDid: 'did:plc:muted',
      createdAt: new Date(),
    };

    it('should create and retrieve a mute', () => {
      mockStorage.upsertMute(testMute);

      const retrieved = mockStorage.getMute(
        testMute.targetDid,
        testMute.actorDid
      );
      expect(retrieved).toEqual(testMute);
    });

    it('should delete a mute', () => {
      mockStorage.upsertMute(testMute);
      mockStorage.deleteMute(testMute.targetDid, testMute.actorDid);

      const key = `${testMute.actorDid}:${testMute.targetDid}`;
      expect(mockStorage._mutes.has(key)).toBe(false);
    });
  });

  describe('Session Operations', () => {
    const testSession = {
      id: 'session-123',
      did: 'did:plc:testuser',
      accessToken: 'encrypted-access-token',
      refreshToken: 'encrypted-refresh-token',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    };

    it('should create and retrieve a session', () => {
      mockStorage.createSession(testSession);

      const sessions = mockStorage.getUserSessions(testSession.did);
      expect(sessions).toContainEqual(testSession);
    });

    it('should delete a session', () => {
      mockStorage.createSession(testSession);
      mockStorage.deleteSession(testSession.id);

      expect(mockStorage._sessions.has(testSession.id)).toBe(false);
    });

    it('should support multiple sessions per user', () => {
      const session1 = testSession;
      const session2 = { ...testSession, id: 'session-456' };

      mockStorage.createSession(session1);
      mockStorage.createSession(session2);

      const sessions = mockStorage.getUserSessions(testSession.did);
      expect(sessions.length).toBe(2);
    });
  });

  describe('Feed Operations', () => {
    it('should return empty timeline by default', () => {
      const timeline = mockStorage.getTimeline();
      expect(timeline).toEqual([]);
    });

    it('should return empty author feed by default', () => {
      const feed = mockStorage.getAuthorFeed();
      expect(feed).toEqual([]);
    });
  });

  describe('Aggregation Operations', () => {
    it('should return default aggregations', () => {
      const aggregations = mockStorage.getPostAggregations();
      expect(aggregations).toEqual({
        likeCount: 0,
        repostCount: 0,
        replyCount: 0,
        quoteCount: 0,
      });
    });
  });

  describe('Clear Operations', () => {
    it('should clear all data', () => {
      mockStorage.upsertUser({
        did: 'did:plc:test',
        handle: 'test.bsky.social',
      });
      mockStorage.upsertPost({
        uri: 'at://test',
        cid: 'cid',
        authorDid: 'did:plc:test',
      });
      mockStorage.upsertLike({ uri: 'at://like', userDid: 'did:plc:test' });

      mockStorage._clear();

      expect(mockStorage._users.size).toBe(0);
      expect(mockStorage._posts.size).toBe(0);
      expect(mockStorage._likes.size).toBe(0);
      expect(mockStorage._reposts.size).toBe(0);
      expect(mockStorage._follows.size).toBe(0);
      expect(mockStorage._blocks.size).toBe(0);
      expect(mockStorage._mutes.size).toBe(0);
      expect(mockStorage._sessions.size).toBe(0);
    });
  });
});

describe('Storage Mock Verification', () => {
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mockStorage = createMockStorage();
  });

  it('should track function calls', () => {
    mockStorage.getUser('did:plc:test');
    mockStorage.getUser('did:plc:another');

    expect(mockStorage.getUser).toHaveBeenCalledTimes(2);
    expect(mockStorage.getUser).toHaveBeenCalledWith('did:plc:test');
    expect(mockStorage.getUser).toHaveBeenCalledWith('did:plc:another');
  });

  it('should allow implementation overrides', () => {
    mockStorage.getUser.mockReturnValue({
      did: 'did:plc:custom',
      handle: 'custom.bsky.social',
    });

    const result = mockStorage.getUser('any-did');
    expect(result).toEqual({
      did: 'did:plc:custom',
      handle: 'custom.bsky.social',
    });
  });

  it('should support async mock implementations', async () => {
    mockStorage.getTimeline.mockResolvedValue([
      { uri: 'at://post1' },
      { uri: 'at://post2' },
    ]);

    const timeline = await mockStorage.getTimeline();
    expect(timeline).toHaveLength(2);
  });
});
