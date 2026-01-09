/**
 * Profile Builder Utility
 *
 * Extracted from xrpc-api.ts to eliminate the deprecated monolithic file.
 * Handles fetching and building complete profile views with all associated data.
 */

import type { Request } from 'express';
import { storage } from '../../../storage';
import { transformBlobToCdnUrl } from './serializers';

// Handle resolution cache (shared across all calls)
const handleResolutionCache = new Map<
  string,
  { did: string; timestamp: number }
>();
const HANDLE_RESOLUTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Clean expired cache entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [handle, cached] of handleResolutionCache.entries()) {
    if (now - cached.timestamp > HANDLE_RESOLUTION_CACHE_TTL) {
      handleResolutionCache.delete(handle);
    }
  }
}, 60 * 1000);

/**
 * Get authenticated DID from request
 */
export async function getAuthenticatedDid(
  req: Request
): Promise<string | null> {
  // Check for DID in request (set by auth middleware)
  if ((req as any).auth?.did) {
    return (req as any).auth.did;
  }

  // Fallback: check session (for backwards compatibility)
  const session = (req as any).session;
  if (session?.did) {
    return session.did;
  }

  return null;
}

/**
 * Helper to add avatar to profile if it exists
 */
function maybeAvatar(
  avatarUrl: string | null,
  did: string,
  req?: Request
): { avatar?: string } {
  if (!avatarUrl) return {};

  const avatarUri = transformBlobToCdnUrl(avatarUrl, did, 'avatar', req);
  if (avatarUri && typeof avatarUri === 'string' && avatarUri.trim() !== '') {
    return { avatar: avatarUri };
  }
  return {};
}

/**
 * Helper to add banner to profile if it exists
 */
function maybeBanner(
  bannerUrl: string | null,
  did: string,
  req?: Request
): { banner?: string } {
  if (!bannerUrl) return {};

  const bannerUri = transformBlobToCdnUrl(bannerUrl, did, 'banner', req);
  if (bannerUri && typeof bannerUri === 'string' && bannerUri.trim() !== '') {
    return { banner: bannerUri };
  }
  return {};
}

/**
 * Convert CID directly to CDN URL
 */
function directCidToCdnUrl(
  cid: string,
  did: string,
  type: 'avatar' | 'banner',
  req?: Request
): string {
  return transformBlobToCdnUrl(cid, did, type, req) as string;
}

/**
 * Build complete profile views for multiple actors
 *
 * @param actors - Array of DIDs or handles to fetch profiles for
 * @param req - Express request object (for viewer context and CDN URL generation)
 * @returns Array of complete profile views
 */
export async function getProfiles(
  actors: string[],
  req: Request
): Promise<any[]> {
  const viewerDid = await getAuthenticatedDid(req);

  // Resolve all handles to DIDs
  const dids = await Promise.all(
    actors.map(async (actor) => {
      if (actor.startsWith('did:')) {
        return actor;
      }

      const handle = actor.toLowerCase();

      // Check cache first
      const cached = handleResolutionCache.get(handle);
      if (
        cached &&
        Date.now() - cached.timestamp < HANDLE_RESOLUTION_CACHE_TTL
      ) {
        return cached.did;
      }

      const user = await storage.getUserByHandle(handle);
      if (user) {
        // Cache the result
        handleResolutionCache.set(handle, {
          did: user.did,
          timestamp: Date.now(),
        });
        return user.did;
      }

      // User not in database - try to resolve from network
      const { didResolver } = await import('../../did-resolver');
      const did = await didResolver.resolveHandle(handle);
      if (did) {
        // Cache the result
        handleResolutionCache.set(handle, {
          did,
          timestamp: Date.now(),
        });
        return did;
      }

      return undefined;
    })
  );

  const uniqueDids = Array.from(new Set(dids.filter(Boolean))) as string[];

  if (uniqueDids.length === 0) {
    return [];
  }

  // Check which users exist in database
  const existingUsers = await storage.getUsers(uniqueDids);
  const existingDids = new Set(existingUsers.map((u) => u.did));
  const missingDids = uniqueDids.filter((did) => !existingDids.has(did));

  // Fetch missing users from their PDSes
  if (missingDids.length > 0) {
    console.log(
      `[PROFILE_BUILDER] Fetching ${missingDids.length} missing user(s) from their PDSes`
    );

    await Promise.all(
      missingDids.map(async (did) => {
        try {
          const { pdsDataFetcher } = await import('../../pds-data-fetcher');
          await pdsDataFetcher.fetchUser(did);
          console.log(
            `[PROFILE_BUILDER] Successfully fetched user ${did} from their PDS`
          );
        } catch (error) {
          console.error(
            `[PROFILE_BUILDER] Failed to fetch user ${did} from PDS:`,
            error
          );
        }
      })
    );
  }

  // Fetch all user data in parallel
  const [
    users,
    followersCounts,
    followingCounts,
    postsCounts,
    listCounts,
    feedgenCounts,
    allLabels,
    relationships,
    mutingLists,
    knownFollowersResults,
  ] = await Promise.all([
    storage.getUsers(uniqueDids),
    storage.getUsersFollowerCounts(uniqueDids),
    storage.getUsersFollowingCounts(uniqueDids),
    storage.getUsersPostCounts(uniqueDids),
    storage.getUsersListCounts(uniqueDids),
    storage.getUsersFeedGeneratorCounts(uniqueDids),
    storage.getLabelsForSubjects(uniqueDids),
    viewerDid
      ? storage.getRelationships(viewerDid, uniqueDids)
      : Promise.resolve(new Map()),
    viewerDid
      ? storage.findMutingListsForUsers(viewerDid, uniqueDids)
      : Promise.resolve(new Map()),
    viewerDid
      ? Promise.all(
          uniqueDids.map((did) => storage.getKnownFollowers(did, viewerDid, 5))
        )
      : Promise.resolve(uniqueDids.map(() => ({ followers: [], count: 0 }))),
  ]);

  // Fetch starter pack counts and labeler statuses for each user
  const starterPackCounts = new Map<string, number>();
  const labelerStatuses = new Map<string, boolean>();

  await Promise.all(
    uniqueDids.map(async (did) => {
      const [starterPacks, labelerServices] = await Promise.all([
        storage.getStarterPacksByCreator(did),
        storage.getLabelerServicesByCreator(did),
      ]);

      starterPackCounts.set(did, starterPacks.starterPacks.length);
      labelerStatuses.set(did, labelerServices.length > 0);
    })
  );

  // Build maps for quick lookup
  const userMap = new Map(users.map((u) => [u.did, u]));
  const labelsBySubject = new Map<string, any[]>();
  allLabels.forEach((label) => {
    if (!labelsBySubject.has(label.subject)) {
      labelsBySubject.set(label.subject, []);
    }
    labelsBySubject.get(label.subject)!.push(label);
  });

  // Fetch pinned posts
  const pinnedPostUris = users
    .map((u) => (u.profileRecord as any)?.pinnedPost?.uri)
    .filter(Boolean);
  const pinnedPosts = await storage.getPosts(pinnedPostUris);
  const pinnedPostCidByUri = new Map<string, string>(
    pinnedPosts.map((p) => [p.uri, p.cid])
  );

  // Build profile views
  const profiles = uniqueDids
    .map((did, i) => {
      const user = userMap.get(did);
      if (!user) return null;

      const profileRecord = user.profileRecord as any;
      const pinnedPostUri = profileRecord?.pinnedPost?.uri;
      const pinnedPostCid = pinnedPostUri
        ? pinnedPostCidByUri.get(pinnedPostUri)
        : undefined;

      const viewerState = viewerDid ? relationships.get(did) : null;
      const mutingList = viewerDid ? mutingLists.get(did) : null;
      const knownFollowersResult = viewerDid
        ? knownFollowersResults[i]
        : { followers: [], count: 0 };

      // Build viewer context
      const viewer: any = {
        knownFollowers: {
          count: knownFollowersResult.count,
          followers: knownFollowersResult.followers
            .filter((f) => f.handle) // Skip followers without valid handles
            .map((f) => {
              const follower: any = {
                did: f.did,
                handle: f.handle,
              };
              // Only include displayName if it exists
              if (f.displayName) follower.displayName = f.displayName;
              // Only include avatar if it exists
              if (f.avatarUrl) {
                const avatarUri = f.avatarUrl.startsWith('http')
                  ? f.avatarUrl
                  : directCidToCdnUrl(f.avatarUrl, f.did, 'avatar', req);
                if (
                  avatarUri &&
                  typeof avatarUri === 'string' &&
                  avatarUri.trim() !== ''
                ) {
                  follower.avatar = avatarUri;
                }
              }
              return follower;
            }),
        },
      };

      if (viewerState) {
        viewer.muted = !!viewerState.muting || !!mutingList;
        if (mutingList) {
          viewer.mutedByList = {
            $type: 'app.bsky.graph.defs#listViewBasic',
            uri: mutingList.uri,
            name: mutingList.name,
            purpose: mutingList.purpose,
          };
        }
        viewer.blockedBy = viewerState.blockedBy;
        if (viewerState.blocking) viewer.blocking = viewerState.blocking;
        if (viewerState.following) viewer.following = viewerState.following;
        if (viewerState.followedBy) viewer.followedBy = viewerState.followedBy;
      }

      // Build complete profile view
      const profileView: any = {
        $type: 'app.bsky.actor.defs#profileViewDetailed',
        did: user.did,
        handle: user.handle,
        displayName: user.displayName || user.handle,
        ...(user.description && { description: user.description }),
        ...maybeAvatar(user.avatarUrl, user.did, req),
        ...maybeBanner(user.bannerUrl, user.did, req),
        followersCount: followersCounts.get(did) || 0,
        followsCount: followingCounts.get(did) || 0,
        postsCount: postsCounts.get(did) || 0,
        indexedAt: user.indexedAt.toISOString(),
        viewer,
        labels: (labelsBySubject.get(did) || []).map((l: any) => ({
          src: l.src,
          uri: l.uri,
          val: l.val,
          neg: l.neg,
          cts: l.createdAt.toISOString(),
        })),
        associated: {
          $type: 'app.bsky.actor.defs#profileAssociated',
          lists: listCounts.get(did) || 0,
          feedgens: feedgenCounts.get(did) || 0,
          starterPacks: starterPackCounts.get(did) || 0,
          labeler: labelerStatuses.get(did) || false,
          chat: undefined,
          activitySubscription: undefined,
        },
      };

      if (pinnedPostUri && pinnedPostCid) {
        profileView.pinnedPost = { uri: pinnedPostUri, cid: pinnedPostCid };
      }

      return profileView;
    })
    .filter(Boolean);

  return profiles;
}
