/**
 * Search Service
 * Handles search for posts, actors, and starter packs
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { searchService } from '../../search';
import { passThroughSearchService } from '../../pass-through-search';
import { getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { maybeAvatar, serializePostsEnhanced } from '../utils/serializers';
import {
  searchActorsSchema,
  searchActorsTypeaheadSchema,
} from '../schemas/actor-schemas';
import { searchPostsSchema } from '../schemas/search-schemas';
import { searchStarterPacksSchema } from '../schemas/starter-pack-schemas';
import type { PostView, UserModel } from '../types';

/**
 * Serialize posts with optional enhanced hydration
 */
async function serializePosts(
  posts: Array<{
    authorDid: string;
    uri: string;
    cid: string;
    text: string;
    embed?: unknown;
    createdAt: Date;
    indexedAt: Date;
    parentUri?: string | null;
    rootUri?: string | null;
  }>,
  viewerDid?: string,
  req?: Request
): Promise<PostView[]> {
  const useEnhancedHydration =
    process.env.ENHANCED_HYDRATION_ENABLED === 'true';

  if (useEnhancedHydration) {
    return serializePostsEnhanced(posts, viewerDid, req) as Promise<PostView[]>;
  }

  // For now, use enhanced serialization as default
  return serializePostsEnhanced(posts, viewerDid, req) as Promise<PostView[]>;
}

/**
 * Search for posts
 * GET /xrpc/app.bsky.feed.searchPosts
 */
export async function searchPosts(req: Request, res: Response): Promise<void> {
  try {
    const params = searchPostsSchema.parse(req.query);

    // Validate query is not empty/whitespace only
    if (!params.q.trim()) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'query string cannot be empty',
      });
      return;
    }

    const viewerDid = await getAuthenticatedDid(req);

    const { posts: localPosts, cursor: localCursor } =
      await searchService.searchPosts(
        params.q,
        {
          limit: params.limit,
          cursor: params.cursor,
          sort: params.sort || 'top',
          since: params.since,
          until: params.until,
          mentions: params.mentions,
          author: params.author,
          lang: params.lang,
          domain: params.domain,
          url: params.url,
          tag: params.tag,
        },
        viewerDid || undefined
      );

    // Augment with remote results from main Bluesky network
    const { posts: mergedPosts, cursor: mergedCursor } =
      await passThroughSearchService.augmentPostSearch(
        localPosts,
        localCursor,
        params.q,
        {
          limit: params.limit,
          cursor: params.cursor,
          sort: params.sort || 'top',
          since: params.since,
          until: params.until,
          mentions: params.mentions,
          author: params.author,
          lang: params.lang,
          domain: params.domain,
          url: params.url,
          tag: params.tag,
        },
        viewerDid || undefined
      );

    const serialized = await serializePosts(
      mergedPosts,
      viewerDid || undefined,
      req
    );

    res.json({ posts: serialized, cursor: mergedCursor });
  } catch (error) {
    handleError(res, error, 'searchPosts');
  }
}

/**
 * Search for actors (users)
 * GET /xrpc/app.bsky.actor.searchActors
 */
export async function searchActors(req: Request, res: Response): Promise<void> {
  try {
    const params = searchActorsSchema.parse(req.query);
    const term = (params.q || params.term)!;

    // Validate query is not empty/whitespace only
    if (!term.trim()) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'query string cannot be empty',
      });
      return;
    }

    const viewerDid = await getAuthenticatedDid(req);

    const { actors: localActors, cursor: localCursor } =
      await searchService.searchActors(term, params.limit, params.cursor);

    // Augment with remote results from main Bluesky network
    const { actors: mergedActors, cursor: mergedCursor } =
      await passThroughSearchService.augmentActorSearch(
        localActors,
        localCursor,
        term,
        {
          limit: params.limit,
          cursor: params.cursor,
        },
        viewerDid || undefined
      );

    type ActorSearchResult = { did: string };
    const actorResults = mergedActors as ActorSearchResult[];
    const dids = actorResults.map((a) => a.did);
    const users = (await storage.getUsers(dids)) as UserModel[];
    const userMap = new Map(users.map((u) => [u.did, u]));

    // Get viewer relationships if authenticated
    const relationships = viewerDid
      ? await storage.getRelationships(viewerDid, dids)
      : new Map();

    const results = actorResults.map((a) => {
      const u = userMap.get(a.did);

      // If user profile not found, create minimal profile with DID
      if (!u) {
        return {
          $type: 'app.bsky.actor.defs#profileView',
          did: a.did,
          handle: a.did, // Use DID as fallback
          displayName: a.did,
          viewer: {
            muted: false,
            blockedBy: false,
          },
        };
      }

      const viewerState = viewerDid ? relationships.get(u.did) : null;
      const viewer: {
        muted: boolean;
        blockedBy: boolean;
        blocking?: string;
        following?: string;
        followedBy?: string;
      } = {
        muted: viewerState ? !!viewerState.muting : false,
        blockedBy: viewerState?.blockedBy || false,
      };
      if (viewerState?.blocking) viewer.blocking = viewerState.blocking;
      if (viewerState?.following) viewer.following = viewerState.following;
      if (viewerState?.followedBy) viewer.followedBy = viewerState.followedBy;

      return {
        $type: 'app.bsky.actor.defs#profileView',
        did: u.did,
        handle: u.handle,
        displayName: u.displayName,
        description: u.description,
        ...maybeAvatar(u.avatarUrl, u.did, req),
        indexedAt: u.indexedAt?.toISOString(),
        viewer,
      };
    });

    res.json({ actors: results, cursor: mergedCursor });
  } catch (error) {
    handleError(res, error, 'searchActors');
  }
}

/**
 * Search actors with typeahead
 * GET /xrpc/app.bsky.actor.searchActorsTypeahead
 */
export async function searchActorsTypeahead(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = searchActorsTypeaheadSchema.parse(req.query);
    const term = (params.q || params.term)!;

    // Validate query is not empty/whitespace only
    if (!term.trim()) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'query string cannot be empty',
      });
      return;
    }

    const viewerDid = await getAuthenticatedDid(req);

    const results = await searchService.searchActorsTypeahead(
      term,
      params.limit
    );

    // Get viewer relationships if authenticated
    const dids = results.map((r) => r.did);
    const relationships = viewerDid
      ? await storage.getRelationships(viewerDid, dids)
      : new Map();

    // Transform to proper profileViewBasic
    const actors = results.map((actor) => {
      const viewerState = viewerDid ? relationships.get(actor.did) : null;
      const viewer: {
        muted: boolean;
        blockedBy: boolean;
        blocking?: string;
        following?: string;
        followedBy?: string;
      } = {
        muted: viewerState ? !!viewerState.muting : false,
        blockedBy: viewerState?.blockedBy || false,
      };
      if (viewerState?.blocking) viewer.blocking = viewerState.blocking;
      if (viewerState?.following) viewer.following = viewerState.following;
      if (viewerState?.followedBy) viewer.followedBy = viewerState.followedBy;

      return {
        $type: 'app.bsky.actor.defs#profileViewBasic',
        did: actor.did,
        handle: actor.handle,
        displayName: actor.displayName,
        ...maybeAvatar(actor.avatarUrl, actor.did, req),
        viewer,
      };
    });

    res.json({ actors });
  } catch (error) {
    handleError(res, error, 'searchActorsTypeahead');
  }
}

/**
 * Search for starter packs
 * GET /xrpc/app.bsky.graph.searchStarterPacks
 */
export async function searchStarterPacks(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = searchStarterPacksSchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);

    const { starterPacks: localPacks, cursor: localCursor } =
      await storage.searchStarterPacksByName(
        params.q,
        params.limit,
        params.cursor
      );

    // Augment with remote results from main Bluesky network
    const { starterPacks: mergedPacks, cursor: mergedCursor } =
      await passThroughSearchService.augmentStarterPackSearch(
        localPacks,
        localCursor,
        params.q,
        {
          limit: params.limit,
          cursor: params.cursor,
        },
        viewerDid || undefined
      );

    res.json({
      starterPacks: mergedPacks.map((sp) => ({
        uri: sp.uri,
        cid: sp.cid,
        creator: { did: sp.creatorDid, handle: sp.creatorDid },
        name: sp.name,
        description: sp.description ?? undefined,
        createdAt: sp.createdAt.toISOString(),
      })),
      cursor: mergedCursor,
    });
  } catch (error) {
    handleError(res, error, 'searchStarterPacks');
  }
}
