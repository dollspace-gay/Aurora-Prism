import { z } from 'zod';
import { didResolver } from './did-resolver';
import { storage } from '../storage';
import type { Post } from '@shared/schema';
import { db } from '../db';
import { blocks } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { isUrlSafeToFetch } from '../utils/security';

// Feed skeleton reason types (repost, pin, etc.)
interface SkeletonReasonRepost {
  $type: 'app.bsky.feed.defs#skeletonReasonRepost';
  repost: string; // URI of the repost record
}

interface SkeletonReasonPin {
  $type: 'app.bsky.feed.defs#skeletonReasonPin';
}

type SkeletonReason = SkeletonReasonRepost | SkeletonReasonPin;

// Skeleton feed item
interface SkeletonFeedPost {
  post: string;
  reason?: SkeletonReason;
}

const skeletonReasonSchema = z.union([
  z.object({
    $type: z.literal('app.bsky.feed.defs#skeletonReasonRepost'),
    repost: z.string(),
  }),
  z.object({
    $type: z.literal('app.bsky.feed.defs#skeletonReasonPin'),
  }),
]);

const skeletonPostSchema = z.object({
  post: z.string(),
  reason: skeletonReasonSchema.optional(),
});

const feedSkeletonResponseSchema = z.object({
  feed: z.array(skeletonPostSchema),
  cursor: z.string().optional(),
});

export interface FeedGeneratorParams {
  feed: string;
  limit: number;
  cursor?: string;
  feedGeneratorDid?: string;
}

export interface HydratedFeedPost {
  post: Post;
  reason?: SkeletonReason;
}

export class FeedGeneratorClient {
  private readonly timeout = 10000; // 10 seconds
  private cache: Map<string, { endpoint: string; timestamp: number }> =
    new Map();
  private readonly cacheTTL = 3600000; // 1 hour

  async getFeedSkeleton(
    serviceEndpoint: string,
    params: FeedGeneratorParams,
    options?: { viewerAuthorization?: string | undefined }
  ): Promise<{ feed: SkeletonFeedPost[]; cursor?: string }> {
    try {
      const url = new URL(
        '/xrpc/app.bsky.feed.getFeedSkeleton',
        serviceEndpoint
      );
      url.searchParams.set('feed', params.feed);
      url.searchParams.set('limit', params.limit.toString());
      if (params.cursor) {
        url.searchParams.set('cursor', params.cursor);
      }

      console.log(`[FeedGenClient] Fetching skeleton from ${url.toString()}`);

      // SSRF protection: validate the service endpoint before fetching
      if (!isUrlSafeToFetch(url.toString())) {
        console.error(
          `[FeedGenClient] SSRF protection: blocked fetch to unsafe URL: ${url.toString()}`
        );
        throw new Error('Feed generator endpoint failed SSRF validation');
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      // Forward viewer Authorization to feed generator when present
      // This is OPTIONAL per AT Protocol spec - feed generators work without auth
      if (options?.viewerAuthorization) {
        headers['Authorization'] = options.viewerAuthorization;
        console.log(
          `[FeedGenClient] Forwarded viewer Authorization header to feedgen`
        );
      }
      // NOTE: We intentionally do NOT send AppView service auth tokens
      // because feed generators are public endpoints and most don't expect/validate them
      // This prevents the "DID syntax didn't validate" error from feed generators

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        console.error(
          `[FeedGenClient] Feed generator returned ${response.status}: ${await response.text()}`
        );
        throw new Error(`Feed generator returned ${response.status}`);
      }

      const data = await response.json();

      // Try to parse the response - if it fails, log the actual response for debugging
      try {
        const skeleton = feedSkeletonResponseSchema.parse(data);

        console.log(
          `[FeedGenClient] Received ${skeleton.feed.length} posts from feed generator`
        );

        return skeleton;
      } catch (parseError) {
        // Log only safe metadata - never log full response which may contain tokens
        const safeMetadata = {
          feedLength: Array.isArray(data?.feed) ? data.feed.length : 'invalid',
          hasCursor: !!data?.cursor,
          responseKeys: data ? Object.keys(data) : [],
        };
        console.error(
          `[FeedGenClient] Invalid response format from feed generator ${serviceEndpoint}:`,
          safeMetadata
        );
        console.error('[FeedGenClient] Parse error:', parseError);

        // Throw a more user-friendly error
        throw new Error(
          `Feed generator at ${serviceEndpoint} returned an invalid response format. ` +
            `This may indicate the feed generator is out of date or misconfigured.`
        );
      }
    } catch (error) {
      console.error('[FeedGenClient] Error fetching skeleton:', error);
      throw error;
    }
  }

  async hydrateSkeleton(
    skeleton: SkeletonFeedPost[],
    viewerDid?: string
  ): Promise<HydratedFeedPost[]> {
    if (skeleton.length === 0) {
      return [];
    }

    const postUris = skeleton.map((item) => item.post);
    console.log(`[FeedGenClient] Hydrating ${postUris.length} posts`);

    // Get users who have blocked the viewer (if viewer is authenticated)
    let blockedByDids: string[] = [];
    if (viewerDid) {
      const blockedByData = await db
        .select({ blockerDid: blocks.blockerDid })
        .from(blocks)
        .where(eq(blocks.blockedDid, viewerDid));
      blockedByDids = blockedByData.map((b) => b.blockerDid);

      if (blockedByDids.length > 0) {
        console.log(
          `[FeedGenClient] Viewer ${viewerDid} is blocked by ${blockedByDids.length} users`
        );
      }
    }

    const posts = await storage.getPosts(postUris);

    const postMap = new Map(posts.map((p) => [p.uri, p]));

    // Collect missing post URIs for on-demand fetching
    const missingUris: string[] = [];
    for (const item of skeleton) {
      if (!postMap.has(item.post)) {
        missingUris.push(item.post);
      }
    }

    // Fetch missing posts from their PDSs
    if (missingUris.length > 0) {
      console.log(
        `[FeedGenClient] Fetching ${missingUris.length} missing posts from PDSs`
      );

      let fetchedCount = 0;
      for (const uri of missingUris) {
        try {
          // Parse AT URI format: at://did/collection/rkey
          const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
          if (!match) {
            console.warn(`[FeedGenClient] Invalid AT URI: ${uri}`);
            continue;
          }

          const [, did, collection, rkey] = match;

          // Only support post fetching for now
          if (collection !== 'app.bsky.feed.post') {
            console.warn(
              `[FeedGenClient] Skipping non-post collection: ${collection}`
            );
            continue;
          }

          // Resolve DID to PDS
          const pdsUrl = await didResolver.resolveDIDToPDS(did);
          if (!pdsUrl) {
            console.warn(`[FeedGenClient] Could not resolve PDS for ${did}`);
            continue;
          }

          // Fetch record from PDS
          const recordUrl = `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;

          // SSRF protection: validate URL before fetching
          if (!isUrlSafeToFetch(recordUrl)) {
            console.warn(
              `[FeedGenClient] SSRF protection: blocked fetch to unsafe PDS URL for ${did}`
            );
            continue;
          }

          const response = await fetch(recordUrl, {
            signal: AbortSignal.timeout(5000),
          });

          if (!response.ok) {
            console.warn(
              `[FeedGenClient] Failed to fetch ${uri}: ${response.status}`
            );
            continue;
          }

          const { value, cid } = await response.json();

          // Process the post through the event processor for proper indexing
          const { eventProcessor } = await import('./event-processor');
          await eventProcessor.processRecord(uri, cid, did, value);
          fetchedCount++;

          // Add to map after processing
          const fetchedPost = await storage.getPost(uri);
          if (fetchedPost) {
            postMap.set(uri, fetchedPost);
          }
        } catch (error) {
          console.warn(
            `[FeedGenClient] Error fetching post ${uri}:`,
            error instanceof Error ? error.message : error
          );
        }
      }

      console.log(
        `[FeedGenClient] Successfully fetched ${fetchedCount}/${missingUris.length} missing posts`
      );
    }

    const hydrated: HydratedFeedPost[] = [];
    let blockedCount = 0;
    for (const item of skeleton) {
      const post = postMap.get(item.post);
      if (post) {
        // Filter out posts from users who have blocked the viewer (nuclear block)
        if (blockedByDids.includes(post.authorDid)) {
          blockedCount++;
          continue;
        }

        hydrated.push({
          post,
          reason: item.reason,
        });
      } else {
        console.warn(
          `[FeedGenClient] Post still not found after fetch attempt: ${item.post}`
        );
      }
    }

    if (blockedCount > 0) {
      console.log(
        `[FeedGenClient] Filtered out ${blockedCount} posts from users who blocked the viewer`
      );
    }

    console.log(
      `[FeedGenClient] Successfully hydrated ${hydrated.length}/${postUris.length} posts`
    );

    return hydrated;
  }

  async resolveFeedGeneratorEndpoint(
    serviceDid: string
  ): Promise<string | null> {
    const cached = this.cache.get(serviceDid);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.endpoint;
    }

    const endpoint = await didResolver.resolveDIDToFeedGenerator(serviceDid);

    if (endpoint) {
      this.cache.set(serviceDid, { endpoint, timestamp: Date.now() });
    }

    return endpoint;
  }

  async getFeed(
    serviceDid: string,
    params: FeedGeneratorParams,
    options?: { viewerAuthorization?: string | undefined; viewerDid?: string }
  ): Promise<{ feed: HydratedFeedPost[]; cursor?: string }> {
    const endpoint = await this.resolveFeedGeneratorEndpoint(serviceDid);

    if (!endpoint) {
      throw new Error(
        `Could not resolve feed generator endpoint for ${serviceDid}`
      );
    }

    const paramsWithDid = {
      ...params,
      feedGeneratorDid: serviceDid,
    };

    const skeleton = await this.getFeedSkeleton(endpoint, paramsWithDid, {
      viewerAuthorization: options?.viewerAuthorization,
    });

    const hydrated = await this.hydrateSkeleton(
      skeleton.feed,
      options?.viewerDid
    );

    return {
      feed: hydrated,
      cursor: skeleton.cursor,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}

export const feedGeneratorClient = new FeedGeneratorClient();
