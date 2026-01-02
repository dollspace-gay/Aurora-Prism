import { vi } from 'vitest';
import { newDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../shared/schema';

// Create an in-memory PostgreSQL database for testing
export function createTestDb(): NodePgDatabase<typeof schema> {
  const mem = newDb();
  
  // Register common functions that pg-mem might not have
  mem.public.registerFunction({
    name: 'current_timestamp',
    args: [],
    returns: 'timestamp',
    implementation: () => new Date(),
  });
  
  mem.public.registerFunction({
    name: 'now',
    args: [],
    returns: 'timestamp',
    implementation: () => new Date(),
  });
  
  // Get a pg-compatible adapter
  const pg = mem.adapters.createPg();
  
  // Create drizzle instance with the in-memory database
  const db = drizzle(pg, { schema });
  
  return db;
}

// Mock database module
export function mockDatabase() {
  const testDb = createTestDb();
  
  vi.mock('../../server/db', () => ({
    db: testDb,
    pool: {},
    createDbPool: () => testDb,
  }));
  
  return testDb;
}

// Create mock storage with common operations
export function createMockStorage() {
  const users = new Map();
  const posts = new Map();
  const likes = new Map();
  const reposts = new Map();
  const follows = new Map();
  const blocks = new Map();
  const mutes = new Map();
  const sessions = new Map();
  
  return {
    // User operations
    getUser: vi.fn((did: string) => users.get(did)),
    getUserByHandle: vi.fn((handle: string) => 
      Array.from(users.values()).find((u: any) => u.handle === handle)
    ),
    upsertUser: vi.fn((user: any) => {
      users.set(user.did, user);
      return user;
    }),
    
    // Post operations
    getPost: vi.fn((uri: string) => posts.get(uri)),
    upsertPost: vi.fn((post: any) => {
      posts.set(post.uri, post);
      return post;
    }),
    deletePost: vi.fn((uri: string) => posts.delete(uri)),
    
    // Like operations
    getLike: vi.fn((uri: string) => likes.get(uri)),
    upsertLike: vi.fn((like: any) => {
      likes.set(like.uri, like);
      return like;
    }),
    deleteLike: vi.fn((uri: string) => likes.delete(uri)),
    
    // Repost operations
    getRepost: vi.fn((uri: string) => reposts.get(uri)),
    upsertRepost: vi.fn((repost: any) => {
      reposts.set(repost.uri, repost);
      return repost;
    }),
    deleteRepost: vi.fn((uri: string) => reposts.delete(uri)),
    
    // Follow operations
    getFollow: vi.fn((uri: string) => follows.get(uri)),
    upsertFollow: vi.fn((follow: any) => {
      follows.set(follow.uri, follow);
      return follow;
    }),
    deleteFollow: vi.fn((uri: string) => follows.delete(uri)),
    
    // Block operations
    getBlock: vi.fn((uri: string) => blocks.get(uri)),
    upsertBlock: vi.fn((block: any) => {
      blocks.set(block.uri, block);
      return block;
    }),
    deleteBlock: vi.fn((uri: string) => blocks.delete(uri)),
    
    // Mute operations
    getMute: vi.fn((targetDid: string, actorDid: string) =>
      mutes.get(`${actorDid}:${targetDid}`)
    ),
    upsertMute: vi.fn((mute: any) => {
      mutes.set(`${mute.actorDid}:${mute.targetDid}`, mute);
      return mute;
    }),
    deleteMute: vi.fn((targetDid: string, actorDid: string) =>
      mutes.delete(`${actorDid}:${targetDid}`)
    ),
    
    // Session operations
    getUserSessions: vi.fn((did: string) => {
      return Array.from(sessions.values()).filter((s: any) => s.did === did);
    }),
    createSession: vi.fn((session: any) => {
      sessions.set(session.id, session);
      return session;
    }),
    deleteSession: vi.fn((id: string) => sessions.delete(id)),
    
    // Feed operations
    getTimeline: vi.fn(() => []),
    getAuthorFeed: vi.fn(() => []),
    
    // Aggregations
    getPostAggregations: vi.fn(() => ({
      likeCount: 0,
      repostCount: 0,
      replyCount: 0,
      quoteCount: 0,
    })),
    
    // Test helpers
    _users: users,
    _posts: posts,
    _likes: likes,
    _reposts: reposts,
    _follows: follows,
    _blocks: blocks,
    _mutes: mutes,
    _sessions: sessions,
    _clear: () => {
      users.clear();
      posts.clear();
      likes.clear();
      reposts.clear();
      follows.clear();
      blocks.clear();
      mutes.clear();
      sessions.clear();
    },
  };
}
