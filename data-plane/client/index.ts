import Redis from 'ioredis';
import type {
  GetProfileRequest as _GetProfileRequest,
  GetProfilesRequest as _GetProfilesRequest,
  SearchActorsRequest as _SearchActorsRequest,
  GetAuthorFeedRequest as _GetAuthorFeedRequest,
  GetTimelineRequest as _GetTimelineRequest,
  GetPostThreadRequest as _GetPostThreadRequest,
  GetPostRequest as _GetPostRequest,
  GetPostsRequest as _GetPostsRequest,
  ProfileRecord,
  FeedItemRecord,
  PostRecord,
  ThreadRecord,
  PaginatedResponse,
} from '../server/types';

interface CacheConfig {
  enabled: boolean;
  ttl: {
    profile: number; // TTL for profile data (seconds)
    post: number; // TTL for post data (seconds)
    feed: number; // TTL for feed data (seconds)
    thread: number; // TTL for thread data (seconds)
  };
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: process.env.DATA_PLANE_CACHE_ENABLED !== 'false',
  ttl: {
    profile: 300, // 5 minutes
    post: 180, // 3 minutes
    feed: 60, // 1 minute (feeds change frequently)
    thread: 120, // 2 minutes
  },
};

interface BatchRequest<T> {
  id: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface BatchQueue {
  profiles: Map<string, BatchRequest<ProfileRecord>[]>;
  posts: Map<string, BatchRequest<PostRecord>[]>;
  timers: {
    profiles: NodeJS.Timeout | null;
    posts: NodeJS.Timeout | null;
  };
}

/**
 * Data-Plane Client
 *
 * This client is used by the AppView layer to query the data-plane.
 * It handles:
 * - HTTP requests to internal data-plane endpoints
 * - Response caching via Redis
 * - Error handling and retries
 * - Automatic request batching for profiles and posts
 */
export class DataPlaneClient {
  private baseUrl: string;
  private timeout: number;
  private redis: Redis | null = null;
  private cacheConfig: CacheConfig;
  private isRedisConnected = false;
  private batchQueue: BatchQueue;
  private batchWindow = 10; // milliseconds to wait before flushing batch
  private maxBatchSize = 50; // maximum items per batch

  constructor(
    baseUrl?: string,
    timeout: number = 5000,
    cacheConfig?: Partial<CacheConfig>
  ) {
    this.baseUrl =
      baseUrl || process.env.DATA_PLANE_URL || 'http://localhost:5001';
    this.timeout = timeout;
    this.cacheConfig = { ...DEFAULT_CACHE_CONFIG, ...cacheConfig };

    // Initialize batch queue
    this.batchQueue = {
      profiles: new Map(),
      posts: new Map(),
      timers: {
        profiles: null,
        posts: null,
      },
    };

    // Initialize Redis if caching is enabled
    if (this.cacheConfig.enabled) {
      this.initRedis();
    }
  }

  private initRedis() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true, // Don't connect immediately
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      this.redis.on('connect', () => {
        console.log('[DATA_PLANE_CLIENT] Connected to Redis cache');
        this.isRedisConnected = true;
      });

      this.redis.on('error', (error) => {
        console.error('[DATA_PLANE_CLIENT] Redis cache error:', error);
        this.isRedisConnected = false;
      });

      // Connect asynchronously
      this.redis.connect().catch((err) => {
        console.error('[DATA_PLANE_CLIENT] Failed to connect to Redis:', err);
      });
    } catch (error) {
      console.error('[DATA_PLANE_CLIENT] Error initializing Redis:', error);
    }
  }

  private getCacheKey(type: string, identifier: string): string {
    return `data_plane:${type}:${identifier}`;
  }

  private async getFromCache<T>(key: string): Promise<T | null> {
    if (!this.redis || !this.isRedisConnected || !this.cacheConfig.enabled) {
      return null;
    }

    try {
      const data = await this.redis.get(key);
      if (data) {
        return JSON.parse(data) as T;
      }
    } catch (error) {
      console.error('[DATA_PLANE_CLIENT] Cache read error:', error);
    }
    return null;
  }

  private async setInCache<T>(
    key: string,
    value: T,
    ttl: number
  ): Promise<void> {
    if (!this.redis || !this.isRedisConnected || !this.cacheConfig.enabled) {
      return;
    }

    try {
      await this.redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.error('[DATA_PLANE_CLIENT] Cache write error:', error);
    }
  }

  private async invalidateCache(key: string): Promise<void> {
    if (!this.redis || !this.isRedisConnected || !this.cacheConfig.enabled) {
      return;
    }

    try {
      await this.redis.del(key);
    } catch (error) {
      console.error('[DATA_PLANE_CLIENT] Cache invalidation error:', error);
    }
  }

  /**
   * Batch request handlers
   */
  private async flushProfileBatch() {
    const queue = this.batchQueue.profiles;
    if (queue.size === 0) return;

    // Clear timer
    if (this.batchQueue.timers.profiles) {
      clearTimeout(this.batchQueue.timers.profiles);
      this.batchQueue.timers.profiles = null;
    }

    // Get all pending profile requests
    const allActors: string[] = [];
    const requestMap = new Map<string, BatchRequest<ProfileRecord>[]>();

    queue.forEach((requests, actor) => {
      allActors.push(actor);
      requestMap.set(actor, requests);
    });

    // Clear the queue
    queue.clear();

    try {
      // Make batch request
      const { profiles } = await this.request<{ profiles: ProfileRecord[] }>(
        '/internal/getProfiles',
        { actors: allActors }
      );

      // Create lookup map
      const profileMap = new Map(
        profiles.map((p) => [p.did, p]).concat(profiles.map((p) => [p.handle, p]))
      );

      // Resolve all pending requests
      allActors.forEach((actor) => {
        const requests = requestMap.get(actor);
        const profile = profileMap.get(actor);

        if (requests) {
          if (profile) {
            // Cache the individual profile
            const cacheKey = this.getCacheKey('profile', actor);
            this.setInCache(cacheKey, profile, this.cacheConfig.ttl.profile);

            // Resolve all requests for this actor
            requests.forEach((req) => req.resolve(profile));
          } else {
            // Profile not found
            const error = new Error(`Profile not found: ${actor}`);
            requests.forEach((req) => req.reject(error));
          }
        }
      });
    } catch (error) {
      // Reject all pending requests
      requestMap.forEach((requests) => {
        requests.forEach((req) =>
          req.reject(
            error instanceof Error ? error : new Error(String(error))
          )
        );
      });
    }
  }

  private async flushPostBatch() {
    const queue = this.batchQueue.posts;
    if (queue.size === 0) return;

    // Clear timer
    if (this.batchQueue.timers.posts) {
      clearTimeout(this.batchQueue.timers.posts);
      this.batchQueue.timers.posts = null;
    }

    // Get all pending post requests
    const allUris: string[] = [];
    const requestMap = new Map<string, BatchRequest<PostRecord>[]>();

    queue.forEach((requests, uri) => {
      allUris.push(uri);
      requestMap.set(uri, requests);
    });

    // Clear the queue
    queue.clear();

    try {
      // Make batch request
      const { posts } = await this.request<{ posts: PostRecord[] }>(
        '/internal/getPosts',
        { uris: allUris }
      );

      // Create lookup map
      const postMap = new Map(posts.map((p) => [p.uri, p]));

      // Resolve all pending requests
      allUris.forEach((uri) => {
        const requests = requestMap.get(uri);
        const post = postMap.get(uri);

        if (requests) {
          if (post) {
            // Cache the individual post
            const cacheKey = this.getCacheKey('post', uri);
            this.setInCache(cacheKey, post, this.cacheConfig.ttl.post);

            // Resolve all requests for this uri
            requests.forEach((req) => req.resolve(post));
          } else {
            // Post not found
            const error = new Error(`Post not found: ${uri}`);
            requests.forEach((req) => req.reject(error));
          }
        }
      });
    } catch (error) {
      // Reject all pending requests
      requestMap.forEach((requests) => {
        requests.forEach((req) =>
          req.reject(
            error instanceof Error ? error : new Error(String(error))
          )
        );
      });
    }
  }

  private scheduleBatchFlush(
    type: 'profiles' | 'posts',
    queueSize: number
  ): void {
    // Flush immediately if we hit max batch size
    if (queueSize >= this.maxBatchSize) {
      if (type === 'profiles') {
        this.flushProfileBatch();
      } else {
        this.flushPostBatch();
      }
      return;
    }

    // Otherwise schedule a flush after the batch window
    if (type === 'profiles' && !this.batchQueue.timers.profiles) {
      this.batchQueue.timers.profiles = setTimeout(() => {
        this.flushProfileBatch();
      }, this.batchWindow);
    } else if (type === 'posts' && !this.batchQueue.timers.posts) {
      this.batchQueue.timers.posts = setTimeout(() => {
        this.flushPostBatch();
      }, this.batchWindow);
    }
  }

  /**
   * Internal request method
   */
  private async request<T>(
    endpoint: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any,
    options: { timeout?: number; retries?: number } = {}
  ): Promise<T> {
    const { timeout = this.timeout, retries = 2 } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: 'Unknown error' }));
          throw new Error(
            `Data-plane error: ${error.error || response.statusText}`
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 4xx errors
        if (
          lastError.message.includes('400') ||
          lastError.message.includes('404')
        ) {
          throw lastError;
        }

        // Retry on network errors or 5xx errors
        if (attempt < retries) {
          const backoff = Math.min(100 * Math.pow(2, attempt), 1000);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  // Profile queries

  async getProfile(actor: string): Promise<ProfileRecord> {
    const cacheKey = this.getCacheKey('profile', actor);

    // Try cache first
    const cached = await this.getFromCache<ProfileRecord>(cacheKey);
    if (cached) {
      return cached;
    }

    // Use batching - add to queue and return a promise
    return new Promise<ProfileRecord>((resolve, reject) => {
      // Get or create request array for this actor
      let requests = this.batchQueue.profiles.get(actor);
      if (!requests) {
        requests = [];
        this.batchQueue.profiles.set(actor, requests);
      }

      // Add this request to the queue
      requests.push({ id: actor, resolve, reject });

      // Schedule batch flush
      this.scheduleBatchFlush('profiles', this.batchQueue.profiles.size);
    });
  }

  async getProfiles(actors: string[]): Promise<{ profiles: ProfileRecord[] }> {
    // For batch requests, we don't cache (would need more complex logic)
    // Could implement partial caching in the future
    return this.request<{ profiles: ProfileRecord[] }>(
      '/internal/getProfiles',
      { actors }
    );
  }

  async searchActors(
    query: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<PaginatedResponse<ProfileRecord>> {
    return this.request<PaginatedResponse<ProfileRecord>>(
      '/internal/searchActors',
      {
        query,
        ...options,
      }
    );
  }

  // Feed queries

  async getAuthorFeed(
    actor: string,
    options: {
      filter?: 'posts_with_replies' | 'posts_no_replies' | 'posts_with_media';
      limit?: number;
      cursor?: string;
    } = {}
  ): Promise<PaginatedResponse<FeedItemRecord>> {
    // Only cache the first page (no cursor) to keep cache simple
    if (!options.cursor) {
      const optionsKey = JSON.stringify({
        filter: options.filter || 'posts_with_replies',
        limit: options.limit || 50,
      });
      const cacheKey = this.getCacheKey('author_feed', `${actor}:${optionsKey}`);

      // Try cache first
      const cached =
        await this.getFromCache<PaginatedResponse<FeedItemRecord>>(cacheKey);
      if (cached) {
        return cached;
      }

      // Fetch from data-plane
      const feed = await this.request<PaginatedResponse<FeedItemRecord>>(
        '/internal/getAuthorFeed',
        {
          actor,
          ...options,
        }
      );

      // Cache the result
      await this.setInCache(cacheKey, feed, this.cacheConfig.ttl.feed);

      return feed;
    }

    // Don't cache paginated results
    return this.request<PaginatedResponse<FeedItemRecord>>(
      '/internal/getAuthorFeed',
      {
        actor,
        ...options,
      }
    );
  }

  async getTimeline(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<PaginatedResponse<FeedItemRecord>> {
    // Only cache the first page (no cursor) to keep cache simple
    if (!options.cursor) {
      const optionsKey = JSON.stringify({ limit: options.limit || 50 });
      const cacheKey = this.getCacheKey('timeline', `${actor}:${optionsKey}`);

      // Try cache first
      const cached =
        await this.getFromCache<PaginatedResponse<FeedItemRecord>>(cacheKey);
      if (cached) {
        return cached;
      }

      // Fetch from data-plane
      const timeline = await this.request<PaginatedResponse<FeedItemRecord>>(
        '/internal/getTimeline',
        {
          actor,
          ...options,
        }
      );

      // Cache the result
      await this.setInCache(cacheKey, timeline, this.cacheConfig.ttl.feed);

      return timeline;
    }

    // Don't cache paginated results
    return this.request<PaginatedResponse<FeedItemRecord>>(
      '/internal/getTimeline',
      {
        actor,
        ...options,
      }
    );
  }

  async getPostThread(
    uri: string,
    options: { depth?: number; parentHeight?: number; viewerDid?: string } = {}
  ): Promise<ThreadRecord> {
    // Create cache key that includes options since they affect the result
    const optionsKey = JSON.stringify({
      depth: options.depth || 6,
      parentHeight: options.parentHeight || 80,
      viewerDid: options.viewerDid || 'anon',
    });
    const cacheKey = this.getCacheKey('thread', `${uri}:${optionsKey}`);

    // Try cache first
    const cached = await this.getFromCache<ThreadRecord>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from data-plane
    const thread = await this.request<ThreadRecord>('/internal/getPostThread', {
      uri,
      ...options,
    });

    // Cache the result
    await this.setInCache(cacheKey, thread, this.cacheConfig.ttl.thread);

    return thread;
  }

  async getPost(uri: string): Promise<PostRecord> {
    const cacheKey = this.getCacheKey('post', uri);

    // Try cache first
    const cached = await this.getFromCache<PostRecord>(cacheKey);
    if (cached) {
      return cached;
    }

    // Use batching - add to queue and return a promise
    return new Promise<PostRecord>((resolve, reject) => {
      // Get or create request array for this uri
      let requests = this.batchQueue.posts.get(uri);
      if (!requests) {
        requests = [];
        this.batchQueue.posts.set(uri, requests);
      }

      // Add this request to the queue
      requests.push({ id: uri, resolve, reject });

      // Schedule batch flush
      this.scheduleBatchFlush('posts', this.batchQueue.posts.size);
    });
  }

  async getPosts(uris: string[]): Promise<{ posts: PostRecord[] }> {
    // For batch requests, we don't cache (would need more complex logic)
    // Could implement partial caching in the future
    return this.request<{ posts: PostRecord[] }>('/internal/getPosts', {
      uris,
    });
  }

  // Graph queries (placeholders - to be implemented)

  async getFollowers(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<any> {
    return this.request('/internal/getFollowers', { actor, ...options });
  }

  async getFollows(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<any> {
    return this.request('/internal/getFollows', { actor, ...options });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getRelationships(actor: string, others: string[]): Promise<any> {
    return this.request('/internal/getRelationships', { actor, others });
  }

  async getBlocks(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<any> {
    return this.request('/internal/getBlocks', { actor, ...options });
  }

  async getMutes(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<any> {
    return this.request('/internal/getMutes', { actor, ...options });
  }

  // Search queries (placeholders)

  async searchPosts(
    query: string,
    options: {
      author?: string;
      since?: string;
      until?: string;
      mentions?: string[];
      limit?: number;
      cursor?: string;
    } = {}
  ): Promise<any> {
    return this.request('/internal/searchPosts', { query, ...options });
  }

  // Notification queries (placeholders)

  async listNotifications(
    actor: string,
    options: { limit?: number; cursor?: string; seenAt?: string } = {}
  ): Promise<any> {
    return this.request('/internal/listNotifications', { actor, ...options });
  }

  async getUnreadCount(
    actor: string,
    seenAt?: string
  ): Promise<{ count: number }> {
    return this.request<{ count: number }>('/internal/getUnreadCount', {
      actor,
      seenAt,
    });
  }

  // Feed generator queries (placeholders)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getFeedGenerators(uris: string[]): Promise<any> {
    return this.request('/internal/getFeedGenerators', { uris });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getFeedGenerator(feed: string): Promise<any> {
    return this.request('/internal/getFeedGenerator', { feed });
  }

  // Health check

  async health(): Promise<{
    status: string;
    service: string;
    timestamp: string;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Health check failed');
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  // Cache management

  /**
   * Clear all cached data
   */
  async clearCache(): Promise<void> {
    if (!this.redis || !this.isRedisConnected) {
      return;
    }

    try {
      const pattern = 'data_plane:*';
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`[DATA_PLANE_CLIENT] Cleared ${keys.length} cache entries`);
      }
    } catch (error) {
      console.error('[DATA_PLANE_CLIENT] Error clearing cache:', error);
    }
  }

  /**
   * Disconnect Redis connection (for cleanup)
   */
  async disconnect(): Promise<void> {
    // Flush any pending batches
    await Promise.all([this.flushProfileBatch(), this.flushPostBatch()]);

    // Clear timers
    if (this.batchQueue.timers.profiles) {
      clearTimeout(this.batchQueue.timers.profiles);
      this.batchQueue.timers.profiles = null;
    }
    if (this.batchQueue.timers.posts) {
      clearTimeout(this.batchQueue.timers.posts);
      this.batchQueue.timers.posts = null;
    }

    if (this.redis) {
      try {
        await this.redis.quit();
        this.isRedisConnected = false;
        console.log('[DATA_PLANE_CLIENT] Disconnected from Redis');
      } catch (error) {
        console.error('[DATA_PLANE_CLIENT] Error disconnecting Redis:', error);
      }
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    enabled: boolean;
    connected: boolean;
    keys: number;
  }> {
    if (!this.redis || !this.isRedisConnected) {
      return { enabled: this.cacheConfig.enabled, connected: false, keys: 0 };
    }

    try {
      const pattern = 'data_plane:*';
      const keys = await this.redis.keys(pattern);
      return {
        enabled: this.cacheConfig.enabled,
        connected: this.isRedisConnected,
        keys: keys.length,
      };
    } catch (error) {
      console.error('[DATA_PLANE_CLIENT] Error getting cache stats:', error);
      return { enabled: this.cacheConfig.enabled, connected: false, keys: 0 };
    }
  }

  /**
   * Get batching statistics
   */
  getBatchStats(): {
    profiles: { pending: number; queued: number };
    posts: { pending: number; queued: number };
  } {
    let profilesPending = 0;
    this.batchQueue.profiles.forEach((requests) => {
      profilesPending += requests.length;
    });

    let postsPending = 0;
    this.batchQueue.posts.forEach((requests) => {
      postsPending += requests.length;
    });

    return {
      profiles: {
        pending: profilesPending,
        queued: this.batchQueue.profiles.size,
      },
      posts: {
        pending: postsPending,
        queued: this.batchQueue.posts.size,
      },
    };
  }
}

// Singleton instance
export const dataPlaneClient = new DataPlaneClient();
