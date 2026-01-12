/**
 * Pass-Through Search Service
 * Augments local search results with results from the main Bluesky network
 * Uses authenticated user OAuth sessions to fetch personalized results
 */

import {
  Agent,
  AppBskyFeedDefs,
  AppBskyActorDefs,
  AppBskyGraphDefs,
} from '@atproto/api';
import { oauthService } from './oauth-service';
import type { PostSearchResult, ActorSearchResult } from './search';
import { storage } from '../storage';

const REMOTE_TIMEOUT_MS = 8000;

interface MergedCursor {
  local?: string;
  remote?: string;
}

/**
 * Encode merged cursor as base64 JSON
 */
function encodeMergedCursor(cursor: MergedCursor): string | undefined {
  if (!cursor.local && !cursor.remote) {
    return undefined;
  }
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

/**
 * Decode merged cursor from base64 JSON
 */
function decodeMergedCursor(cursor?: string): MergedCursor {
  if (!cursor) {
    return {};
  }

  // Defense in depth: reject obviously malicious cursors
  if (cursor.length > 10000) {
    console.warn('[PASS_THROUGH] Cursor too long, treating as invalid');
    return {};
  }

  try {
    // Check if it's a merged cursor (base64 JSON)
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());

    // Validate structure to prevent prototype pollution
    if (
      decoded &&
      typeof decoded === 'object' &&
      !Array.isArray(decoded) &&
      decoded.constructor === Object
    ) {
      const local =
        typeof decoded.local === 'string' ? decoded.local : undefined;
      const remote =
        typeof decoded.remote === 'string' ? decoded.remote : undefined;

      if (local || remote) {
        return { local, remote };
      }
    }

    // Legacy cursor - treat as local only
    return { local: cursor };
  } catch {
    // Invalid cursor - treat as local only
    return { local: cursor };
  }
}

interface PostSearchParams {
  limit?: number;
  cursor?: string;
  sort?: 'top' | 'latest';
  since?: string;
  until?: string;
  mentions?: string;
  author?: string;
  lang?: string;
  domain?: string;
  url?: string;
  tag?: string[];
}

interface ActorSearchParams {
  limit?: number;
  cursor?: string;
}

interface StarterPackSearchParams {
  limit?: number;
  cursor?: string;
}

interface FeedGeneratorSearchParams {
  limit?: number;
  cursor?: string;
  query?: string;
}

// Use actual AT Protocol types from @atproto/api
type RemotePost = AppBskyFeedDefs.PostView;
type RemoteActor = AppBskyActorDefs.ProfileView;
type RemoteStarterPack = AppBskyGraphDefs.StarterPackViewBasic;
type RemoteFeedGenerator = AppBskyFeedDefs.GeneratorView;

/**
 * Pass-Through Search Service
 * Fetches results from main Bluesky network and merges with local results
 */
class PassThroughSearchService {
  /**
   * Create an authenticated agent for a user
   * Returns null if OAuth session doesn't exist or is invalid
   */
  private async getAuthenticatedAgent(userDid: string): Promise<Agent | null> {
    try {
      const oauthSession = await oauthService.getSession(userDid);
      if (!oauthSession) {
        console.log('[PASS_THROUGH] No OAuth session found for user:', userDid);
        return null;
      }

      const agent = new Agent(oauthSession);
      console.log(
        '[PASS_THROUGH] Created authenticated agent for user:',
        userDid
      );
      return agent;
    } catch (error) {
      console.error(
        '[PASS_THROUGH] Failed to create authenticated agent:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Get set of DIDs that viewer has blocked or muted locally
   * Used to filter remote results to respect local moderation
   */
  private async getBlockedAndMutedDids(
    viewerDid: string
  ): Promise<Set<string>> {
    try {
      const blockedDids = new Set<string>();

      // Get list blocks and mutes from local database
      const [listBlocks, listMutes] = await Promise.all([
        storage.getListBlocksForUsers(viewerDid, []) as Promise<
          Map<string, { listUri: string }>
        >,
        storage.getListMutesForUsers(viewerDid, []) as Promise<
          Map<string, { listUri: string }>
        >,
      ]);

      // Add blocked DIDs
      for (const did of listBlocks.keys()) {
        blockedDids.add(did);
      }

      // Add muted DIDs
      for (const did of listMutes.keys()) {
        blockedDids.add(did);
      }

      if (blockedDids.size > 0) {
        console.log(
          `[PASS_THROUGH] Viewer ${viewerDid} has ${blockedDids.size} blocked/muted DIDs`
        );
      }

      return blockedDids;
    } catch (error) {
      console.warn(
        '[PASS_THROUGH] Failed to fetch blocked/muted DIDs:',
        error instanceof Error ? error.message : error
      );
      return new Set();
    }
  }

  /**
   * Fetch posts from main Bluesky network with timeout
   */
  private async fetchRemotePosts(
    query: string,
    params: PostSearchParams,
    remoteCursor: string | undefined,
    agent: Agent | null
  ): Promise<{ posts: RemotePost[]; cursor?: string }> {
    if (!agent) {
      return { posts: [] };
    }

    try {
      const fetchPromise = agent.app.bsky.feed.searchPosts({
        q: query,
        limit: params.limit || 25,
        cursor: remoteCursor,
        sort: params.sort,
        since: params.since,
        until: params.until,
        mentions: params.mentions,
        author: params.author,
        lang: params.lang,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Remote search timeout')),
          REMOTE_TIMEOUT_MS
        )
      );

      const response = await Promise.race([fetchPromise, timeoutPromise]);
      console.log(
        `[PASS_THROUGH] Fetched ${response.data.posts.length} posts from remote`
      );
      return {
        posts: response.data.posts,
        cursor: response.data.cursor,
      };
    } catch (error) {
      console.warn(
        '[PASS_THROUGH] Failed to fetch remote posts:',
        error instanceof Error ? error.message : error
      );
      return { posts: [] };
    }
  }

  /**
   * Fetch actors from main Bluesky network with timeout
   */
  private async fetchRemoteActors(
    query: string,
    params: ActorSearchParams,
    remoteCursor: string | undefined,
    agent: Agent | null
  ): Promise<{ actors: RemoteActor[]; cursor?: string }> {
    if (!agent) {
      return { actors: [] };
    }

    try {
      const fetchPromise = agent.app.bsky.actor.searchActors({
        q: query,
        limit: params.limit || 25,
        cursor: remoteCursor,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Remote search timeout')),
          REMOTE_TIMEOUT_MS
        )
      );

      const response = await Promise.race([fetchPromise, timeoutPromise]);
      console.log(
        `[PASS_THROUGH] Fetched ${response.data.actors.length} actors from remote`
      );
      return {
        actors: response.data.actors,
        cursor: response.data.cursor,
      };
    } catch (error) {
      console.warn(
        '[PASS_THROUGH] Failed to fetch remote actors:',
        error instanceof Error ? error.message : error
      );
      return { actors: [] };
    }
  }

  /**
   * Fetch starter packs from main Bluesky network with timeout
   */
  private async fetchRemoteStarterPacks(
    query: string,
    params: StarterPackSearchParams,
    remoteCursor: string | undefined,
    agent: Agent | null
  ): Promise<{ starterPacks: RemoteStarterPack[]; cursor?: string }> {
    if (!agent) {
      return { starterPacks: [] };
    }

    try {
      const fetchPromise = agent.app.bsky.graph.searchStarterPacks({
        q: query,
        limit: params.limit || 25,
        cursor: remoteCursor,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Remote search timeout')),
          REMOTE_TIMEOUT_MS
        )
      );

      const response = await Promise.race([fetchPromise, timeoutPromise]);
      console.log(
        `[PASS_THROUGH] Fetched ${response.data.starterPacks.length} starter packs from remote`
      );
      return {
        starterPacks: response.data.starterPacks,
        cursor: response.data.cursor,
      };
    } catch (error) {
      console.warn(
        '[PASS_THROUGH] Failed to fetch remote starter packs:',
        error instanceof Error ? error.message : error
      );
      return { starterPacks: [] };
    }
  }

  /**
   * Fetch feed generators from main Bluesky network with timeout
   */
  private async fetchRemoteFeedGenerators(
    params: FeedGeneratorSearchParams,
    remoteCursor: string | undefined,
    agent: Agent | null
  ): Promise<{ feedGenerators: RemoteFeedGenerator[]; cursor?: string }> {
    if (!agent) {
      return { feedGenerators: [] };
    }

    try {
      const fetchPromise = agent.app.bsky.unspecced.getPopularFeedGenerators({
        query: params.query,
        limit: params.limit || 25,
        cursor: remoteCursor,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Remote search timeout')),
          REMOTE_TIMEOUT_MS
        )
      );

      const response = await Promise.race([fetchPromise, timeoutPromise]);
      console.log(
        `[PASS_THROUGH] Fetched ${response.data.feeds.length} feed generators from remote`
      );
      return {
        feedGenerators: response.data.feeds,
        cursor: response.data.cursor,
      };
    } catch (error) {
      console.warn(
        '[PASS_THROUGH] Failed to fetch remote feed generators:',
        error instanceof Error ? error.message : error
      );
      return { feedGenerators: [] };
    }
  }

  /**
   * Convert remote post to local PostSearchResult format
   */
  private remotePostToLocal(remotePost: RemotePost): PostSearchResult {
    // Extract post data from record
    const record = remotePost.record as {
      text?: string;
      createdAt?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AT Protocol embed structure is dynamic
      embed?: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AT Protocol reply structure is dynamic
      reply?: any;
    };

    return {
      uri: remotePost.uri,
      cid: remotePost.cid,
      authorDid: remotePost.author.did,
      text: record.text || '',
      embed: remotePost.embed || record.embed,
      parentUri: record.reply?.parent?.uri || null,
      rootUri: record.reply?.root?.uri || null,
      createdAt: new Date(record.createdAt || remotePost.indexedAt),
      indexedAt: new Date(remotePost.indexedAt),
      searchVector: null,
      rank: 0.5,
    };
  }

  /**
   * Convert remote actor to local ActorSearchResult format
   */
  private remoteActorToLocal(remoteActor: RemoteActor): ActorSearchResult {
    return {
      did: remoteActor.did,
      handle: remoteActor.handle,
      displayName: remoteActor.displayName || null,
      avatarUrl: remoteActor.avatar || null,
      description: remoteActor.description || null,
      rank: 0.5,
    };
  }

  /**
   * Augment post search results with remote results
   */
  async augmentPostSearch(
    localPosts: PostSearchResult[],
    localCursor: string | undefined,
    query: string,
    params: PostSearchParams,
    userDid?: string
  ): Promise<{ posts: PostSearchResult[]; cursor?: string }> {
    if (!userDid) {
      console.log(
        '[PASS_THROUGH] No user DID provided, returning local results only'
      );
      return {
        posts: localPosts,
        cursor: localCursor,
      };
    }

    const agent = await this.getAuthenticatedAgent(userDid);
    if (!agent) {
      console.log(
        '[PASS_THROUGH] Could not create agent, returning local results only'
      );
      return {
        posts: localPosts,
        cursor: localCursor,
      };
    }

    // Decode cursor to get remote cursor
    const decodedCursor = decodeMergedCursor(params.cursor);

    // Fetch blocked/muted DIDs to filter remote results
    const blockedDids = await this.getBlockedAndMutedDids(userDid);

    const remoteResult = await this.fetchRemotePosts(
      query,
      params,
      decodedCursor.remote,
      agent
    );

    const localUris = new Set(localPosts.map((p) => p.uri));
    const uniqueRemotePosts = remoteResult.posts
      .filter((p) => !localUris.has(p.uri))
      .filter((p) => !blockedDids.has(p.author.did)) // Filter blocked/muted authors
      .map((p) => this.remotePostToLocal(p));

    const merged = [...localPosts, ...uniqueRemotePosts];

    const sortField = params.sort === 'latest' ? 'createdAt' : 'rank';
    merged.sort((a, b) => {
      if (sortField === 'rank') {
        return (b.rank || 0) - (a.rank || 0);
      } else {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
    });

    if (uniqueRemotePosts.length > 0) {
      console.log(
        `[PASS_THROUGH] Merged ${localPosts.length} local + ${uniqueRemotePosts.length} remote posts = ${merged.length} total`
      );
    }

    return {
      posts: merged,
      cursor: encodeMergedCursor({
        local: localCursor,
        remote: remoteResult.cursor,
      }),
    };
  }

  /**
   * Augment actor search results with remote results
   */
  async augmentActorSearch(
    localActors: ActorSearchResult[],
    localCursor: string | undefined,
    query: string,
    params: ActorSearchParams,
    userDid?: string
  ): Promise<{ actors: ActorSearchResult[]; cursor?: string }> {
    if (!userDid) {
      console.log(
        '[PASS_THROUGH] No user DID provided, returning local results only'
      );
      return {
        actors: localActors,
        cursor: localCursor,
      };
    }

    const agent = await this.getAuthenticatedAgent(userDid);
    if (!agent) {
      console.log(
        '[PASS_THROUGH] Could not create agent, returning local results only'
      );
      return {
        actors: localActors,
        cursor: localCursor,
      };
    }

    // Decode cursor to get remote cursor
    const decodedCursor = decodeMergedCursor(params.cursor);

    // Fetch blocked/muted DIDs to filter remote results
    const blockedDids = await this.getBlockedAndMutedDids(userDid);

    const remoteResult = await this.fetchRemoteActors(
      query,
      params,
      decodedCursor.remote,
      agent
    );

    const localDids = new Set(localActors.map((a) => a.did));
    const uniqueRemoteActors = remoteResult.actors
      .filter((a) => !localDids.has(a.did))
      .filter((a) => !blockedDids.has(a.did)) // Filter blocked/muted actors
      .map((a) => this.remoteActorToLocal(a));

    const merged = [...localActors, ...uniqueRemoteActors];

    merged.sort((a, b) => (b.rank || 0) - (a.rank || 0));

    if (uniqueRemoteActors.length > 0) {
      console.log(
        `[PASS_THROUGH] Merged ${localActors.length} local + ${uniqueRemoteActors.length} remote actors = ${merged.length} total`
      );
    }

    return {
      actors: merged,
      cursor: encodeMergedCursor({
        local: localCursor,
        remote: remoteResult.cursor,
      }),
    };
  }

  /**
   * Augment starter pack search results with remote results
   */
  async augmentStarterPackSearch(
    localPacks: Array<{
      uri: string;
      cid: string;
      creatorDid: string;
      name: string | null;
      description: string | null;
      createdAt: Date;
    }>,
    localCursor: string | undefined,
    query: string,
    params: StarterPackSearchParams,
    userDid?: string
  ): Promise<{
    starterPacks: Array<{
      uri: string;
      cid: string;
      creatorDid: string;
      name: string | null;
      description: string | null;
      createdAt: Date;
    }>;
    cursor?: string;
  }> {
    if (!userDid) {
      console.log(
        '[PASS_THROUGH] No user DID provided, returning local results only'
      );
      return {
        starterPacks: localPacks,
        cursor: localCursor,
      };
    }

    const agent = await this.getAuthenticatedAgent(userDid);
    if (!agent) {
      console.log(
        '[PASS_THROUGH] Could not create agent, returning local results only'
      );
      return {
        starterPacks: localPacks,
        cursor: localCursor,
      };
    }

    // Decode cursor to get remote cursor
    const decodedCursor = decodeMergedCursor(params.cursor);

    // Fetch blocked/muted DIDs to filter remote results
    const blockedDids = await this.getBlockedAndMutedDids(userDid);

    const remoteResult = await this.fetchRemoteStarterPacks(
      query,
      params,
      decodedCursor.remote,
      agent
    );

    const localUris = new Set(localPacks.map((p) => p.uri));
    const uniqueRemotePacks = remoteResult.starterPacks
      .filter((p) => !localUris.has(p.uri))
      .filter((p) => !blockedDids.has(p.creator.did)) // Filter blocked/muted creators
      .map((p) => {
        // Extract starter pack data from record
        const record = p.record as {
          name?: string;
          description?: string;
          createdAt?: string;
        };

        return {
          uri: p.uri,
          cid: p.cid,
          creatorDid: p.creator.did,
          name: record.name || null,
          description: record.description || null,
          createdAt: new Date(record.createdAt || p.indexedAt),
        };
      });

    const merged = [...localPacks, ...uniqueRemotePacks];

    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (uniqueRemotePacks.length > 0) {
      console.log(
        `[PASS_THROUGH] Merged ${localPacks.length} local + ${uniqueRemotePacks.length} remote starter packs = ${merged.length} total`
      );
    }

    return {
      starterPacks: merged,
      cursor: encodeMergedCursor({
        local: localCursor,
        remote: remoteResult.cursor,
      }),
    };
  }

  /**
   * Augment feed generator search results with remote results
   */
  async augmentFeedGeneratorSearch(
    localFeedGenerators: RemoteFeedGenerator[],
    localCursor: string | undefined,
    params: FeedGeneratorSearchParams,
    userDid?: string
  ): Promise<{ feedGenerators: RemoteFeedGenerator[]; cursor?: string }> {
    if (!userDid) {
      console.log(
        '[PASS_THROUGH] No user DID provided, returning local results only'
      );
      return {
        feedGenerators: localFeedGenerators,
        cursor: localCursor,
      };
    }

    const agent = await this.getAuthenticatedAgent(userDid);
    if (!agent) {
      console.log(
        '[PASS_THROUGH] Could not create agent, returning local results only'
      );
      return {
        feedGenerators: localFeedGenerators,
        cursor: localCursor,
      };
    }

    // Decode cursor to get remote cursor
    const decodedCursor = decodeMergedCursor(params.cursor);

    // Fetch blocked/muted DIDs to filter remote results
    const blockedDids = await this.getBlockedAndMutedDids(userDid);

    const remoteResult = await this.fetchRemoteFeedGenerators(
      params,
      decodedCursor.remote,
      agent
    );

    const localUris = new Set(localFeedGenerators.map((f) => f.uri));
    const uniqueRemoteFeedGenerators = remoteResult.feedGenerators
      .filter((f) => !localUris.has(f.uri))
      .filter((f) => !blockedDids.has(f.creator.did)); // Filter blocked/muted creators

    const merged = [...localFeedGenerators, ...uniqueRemoteFeedGenerators];

    // Sort by likeCount (descending)
    merged.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));

    if (uniqueRemoteFeedGenerators.length > 0) {
      console.log(
        `[PASS_THROUGH] Merged ${localFeedGenerators.length} local + ${uniqueRemoteFeedGenerators.length} remote feed generators = ${merged.length} total`
      );
    }

    return {
      feedGenerators: merged,
      cursor: encodeMergedCursor({
        local: localCursor,
        remote: remoteResult.cursor,
      }),
    };
  }
}

export const passThroughSearchService = new PassThroughSearchService();
