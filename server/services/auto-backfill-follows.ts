/**
 * Automatic Backfill Service for Follows and Profile Information
 * Backfills missing follow relationships and profile info for follows/followers
 */

import { AtpAgent } from '@atproto/api';
import { storage } from '../storage';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { follows, userSettings } from '@shared/schema';
import type { ATCommitEvent } from '../types/atproto';
import { EventProcessor } from './event-processor';
import {
  getErrorMessage,
  hasErrorStatus,
  hasErrorCode,
  getErrorCode,
  getErrorStatus,
} from '../utils/error-utils';
import type { DIDDocument } from '../types/atproto';

const BATCH_SIZE = 100;
const CONCURRENT_FETCHES = 50; // Increased from 10 to 50 for faster processing
const BACKFILL_COOLDOWN_HOURS = 1; // Cooldown before re-running automatic backfill
const MAX_FOLLOW_RECORDS_TO_CHECK = 500; // Don't paginate through more than 500 follows per user

// Track ongoing backfills to prevent duplicates
const ongoingBackfills = new Set<string>();

// Track ongoing new follow backfills to prevent duplicate cascading
const ongoingNewFollowBackfills = new Set<string>();

// Track recently backfilled users to prevent spam (DID -> timestamp)
const recentlyBackfilledUsers = new Map<string, number>();
const NEW_FOLLOW_BACKFILL_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown

export class AutoBackfillFollowsService {
  constructor() {
    // Periodically clean up old entries from recentlyBackfilledUsers to prevent memory leaks
    setInterval(
      () => {
        const now = Date.now();
        let cleaned = 0;
        const entries = Array.from(recentlyBackfilledUsers.entries());
        for (const [did, timestamp] of entries) {
          if (now - timestamp > NEW_FOLLOW_BACKFILL_COOLDOWN_MS) {
            recentlyBackfilledUsers.delete(did);
            cleaned++;
          }
        }
        if (cleaned > 0) {
          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Cleaned ${cleaned} expired cooldown entries`
          );
        }
      },
      60 * 60 * 1000
    ); // Run every hour
  }

  /**
   * Check if a user needs follows backfilled and trigger it if needed
   * Called automatically on login
   */
  async checkAndBackfill(userDid: string): Promise<boolean> {
    // Skip if already backfilling for this user
    if (ongoingBackfills.has(userDid)) {
      console.log(
        '[AUTO_BACKFILL_FOLLOWS] Already backfilling for %s',
        userDid
      );
      return false;
    }

    try {
      // Check cooldown - don't backfill if we did it recently
      const settings = await db.query.userSettings.findFirst({
        where: (s, { eq }) => eq(s.userDid, userDid),
      });

      if (settings?.lastFollowsBackfill) {
        const hoursSinceLastBackfill =
          (Date.now() - settings.lastFollowsBackfill.getTime()) /
          (1000 * 60 * 60);

        if (hoursSinceLastBackfill < BACKFILL_COOLDOWN_HOURS) {
          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Skipping ${userDid} - backfilled ${Math.round(hoursSinceLastBackfill)}h ago`
          );
          return false;
        }
      }

      console.log(
        '[AUTO_BACKFILL_FOLLOWS] Triggering backfill for %s',
        userDid
      );

      // Trigger backfill in background
      this.backfillInBackground(userDid);

      return true;
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error checking user ${userDid}:`,
        error
      );
      return false;
    }
  }

  /**
   * Manually trigger backfill bypassing cooldown checks
   * Used for manual user-initiated backfills
   */
  async forceBackfill(userDid: string): Promise<boolean> {
    // Skip if already backfilling for this user
    if (ongoingBackfills.has(userDid)) {
      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Already backfilling for ${userDid} - skipping force trigger`
      );
      return false;
    }

    console.log(
      `[AUTO_BACKFILL_FOLLOWS] Force backfill triggered for ${userDid} (bypassing cooldown)`
    );

    // Trigger backfill in background without cooldown check
    this.backfillInBackground(userDid);
    return true;
  }

  /**
   * Run backfill in the background (non-blocking)
   */
  private backfillInBackground(userDid: string): void {
    ongoingBackfills.add(userDid);

    (async () => {
      try {
        console.log(
          `[AUTO_BACKFILL_FOLLOWS] Starting background backfill for ${userDid}`
        );

        // Step 1: Backfill follow relationships from PDS
        await this.backfillFollowRelationships(userDid);

        // Step 2: Backfill profile info for all related users
        await this.backfillProfileInfo(userDid);

        // Step 3: Backfill posts from all followed users
        await this.backfillFollowedUsersPosts(userDid);

        // Update last backfill timestamp
        await db
          .insert(userSettings)
          .values({
            userDid,
            lastFollowsBackfill: new Date(),
          })
          .onConflictDoUpdate({
            target: userSettings.userDid,
            set: {
              lastFollowsBackfill: new Date(),
            },
          });

        console.log('[AUTO_BACKFILL_FOLLOWS] Complete for %s!', userDid);
      } catch (error) {
        console.error(
          `[AUTO_BACKFILL_FOLLOWS] Fatal error for ${userDid}:`,
          error
        );
      } finally {
        ongoingBackfills.delete(userDid);
      }
    })();
  }

  /**
   * Backfill follow relationships (who user follows and who follows them)
   *
   * Part 1: Fetch outgoing follows from user's PDS (proper ATProto)
   * Part 2: Fetch incoming followers from Bluesky public AppView, then fetch
   *         the actual follow records from each follower's PDS
   */
  private async backfillFollowRelationships(userDid: string): Promise<void> {
    const eventProcessor = new EventProcessor({ storage });
    eventProcessor.setSkipPdsFetching(true);
    eventProcessor.setSkipDataCollectionCheck(true);

    // PART 1: Fetch outgoing follows from user's PDS
    let followingFetched = 0;
    try {
      const { didResolver } = await import('./did-resolver');
      const didDoc = await didResolver.resolveDID(userDid);

      if (!didDoc) {
        console.error(
          `[AUTO_BACKFILL_FOLLOWS] Could not resolve DID ${userDid}`
        );
      } else {
        const services = (didDoc as DIDDocument).service || [];
        const pdsService = services.find(
          (s) =>
            s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
        );

        if (!pdsService?.serviceEndpoint) {
          console.error(
            `[AUTO_BACKFILL_FOLLOWS] No PDS endpoint found for ${userDid}`
          );
        } else {
          const userPdsEndpoint = pdsService.serviceEndpoint;
          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Fetching outgoing follows from PDS: ${userPdsEndpoint}`
          );

          const agent = new AtpAgent({ service: userPdsEndpoint });
          let cursor: string | undefined;

          do {
            try {
              const response = await agent.com.atproto.repo.listRecords({
                repo: userDid,
                collection: 'app.bsky.graph.follow',
                limit: 100,
                cursor: cursor,
              });

              console.log(
                `[AUTO_BACKFILL_FOLLOWS] Found ${response.data.records.length} outgoing follow records`
              );

              for (const record of response.data.records) {
                try {
                  // Use the original createdAt from the follow record for proper ordering
                  const createdAt =
                    record.value?.createdAt || new Date().toISOString();

                  await eventProcessor.processCommit({
                    repo: userDid,
                    ops: [
                      {
                        action: 'create',
                        path: `app.bsky.graph.follow/${record.uri.split('/').pop()}`,
                        cid: record.cid,
                        record: record.value as Record<string, unknown>,
                      },
                    ],
                    time: createdAt,
                    rev: '',
                  } as ATCommitEvent);

                  followingFetched++;
                } catch (error: unknown) {
                  console.error(
                    `[AUTO_BACKFILL_FOLLOWS] Error processing outgoing follow:`,
                    getErrorMessage(error)
                  );
                }
              }

              cursor = response.data.cursor;
            } catch (error: unknown) {
              console.error(
                `[AUTO_BACKFILL_FOLLOWS] Error listing follow records:`,
                getErrorMessage(error)
              );
              break;
            }
          } while (cursor);
        }
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetched ${followingFetched} outgoing follows`
      );
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error backfilling outgoing follows:`,
        error
      );
    }

    // PART 2: Fetch incoming followers via Bluesky public AppView
    let followersFetched = 0;
    try {
      const bskyAppView = 'https://public.api.bsky.app';
      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetching followers list from Bluesky AppView: ${bskyAppView}`
      );

      const bskyAgent = new AtpAgent({ service: bskyAppView });
      let cursor: string | undefined;
      const followerDids: string[] = [];

      // First, collect all follower DIDs from Bluesky AppView
      do {
        try {
          const response = await bskyAgent.app.bsky.graph.getFollowers({
            actor: userDid,
            limit: 100,
            cursor: cursor,
          });

          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Found ${response.data.followers.length} followers in this batch`
          );

          for (const follower of response.data.followers) {
            followerDids.push(follower.did);
          }

          cursor = response.data.cursor;
        } catch (error: unknown) {
          console.error(
            `[AUTO_BACKFILL_FOLLOWS] Error fetching followers from Bluesky:`,
            getErrorMessage(error)
          );
          break;
        }
      } while (cursor);

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Found ${followerDids.length} total followers, fetching their follow records...`
      );

      // Now fetch the actual follow records from each follower's PDS
      const { didResolver } = await import('./did-resolver');
      let successCount = 0;
      let failedCount = 0;

      for (let i = 0; i < followerDids.length; i += CONCURRENT_FETCHES) {
        const batch = followerDids.slice(i, i + CONCURRENT_FETCHES);

        await Promise.all(
          batch.map(async (followerDid) => {
            try {
              // Resolve follower's DID to find their PDS
              const followerDidDoc = await didResolver.resolveDID(followerDid);
              if (!followerDidDoc) {
                failedCount++;
                return;
              }

              const services = (followerDidDoc as DIDDocument).service || [];
              const pdsService = services.find(
                (s) =>
                  s.type === 'AtprotoPersonalDataServer' ||
                  s.id === '#atproto_pds'
              );

              if (!pdsService?.serviceEndpoint) {
                failedCount++;
                return;
              }

              // List their follow records to find the one pointing to userDid
              // IMPORTANT: Paginate through ALL records, not just first 100
              const followerAgent = new AtpAgent({
                service: pdsService.serviceEndpoint,
              });

              type FollowRecordType = {
                uri: string;
                cid: string;
                value?: Record<string, unknown>;
              };
              let followRecord: FollowRecordType | undefined = undefined;
              let followCursor: string | undefined;
              let recordsChecked = 0;

              // Paginate through follow records to find the one pointing to userDid
              // Limit pagination to prevent getting stuck on users who follow thousands
              do {
                const records =
                  await followerAgent.com.atproto.repo.listRecords({
                    repo: followerDid,
                    collection: 'app.bsky.graph.follow',
                    limit: 100,
                    cursor: followCursor,
                  });

                recordsChecked += records.data.records.length;

                // Find the follow record pointing to our user
                const found = records.data.records.find(
                  (r) =>
                    (r.value as Record<string, unknown> | undefined)
                      ?.subject === userDid
                );
                if (found) {
                  followRecord = found as FollowRecordType;
                }

                if (followRecord) {
                  break; // Found it, stop paginating
                }

                followCursor = records.data.cursor;

                // Safety limit: don't check more than MAX_FOLLOW_RECORDS_TO_CHECK records
                if (recordsChecked >= MAX_FOLLOW_RECORDS_TO_CHECK) {
                  console.warn(
                    `[AUTO_BACKFILL_FOLLOWS] Hit pagination limit for ${followerDid} (checked ${recordsChecked} records)`
                  );
                  break;
                }
              } while (followCursor && !followRecord);

              if (followRecord) {
                // Use the original createdAt from the follow record for proper ordering
                const createdAt =
                  (followRecord.value?.createdAt as string | undefined) ||
                  new Date().toISOString();

                await eventProcessor.processCommit({
                  repo: followerDid,
                  ops: [
                    {
                      action: 'create',
                      path: `app.bsky.graph.follow/${followRecord.uri.split('/').pop()}`,
                      cid: followRecord.cid,
                      record: followRecord.value,
                    },
                  ],
                  time: createdAt,
                  rev: '',
                } as ATCommitEvent);

                followersFetched++;
                successCount++;
              } else {
                // Follow record not found - log for debugging
                console.warn(
                  `[AUTO_BACKFILL_FOLLOWS] No follow record found from ${followerDid} to ${userDid}`
                );
                failedCount++;
              }
            } catch (error: unknown) {
              const msg = getErrorMessage(error);
              const status = getErrorStatus(error);
              const code = getErrorCode(error);

              if (hasErrorStatus(error, 404) || msg.includes('not found')) {
                // User or record doesn't exist
                console.warn(
                  `[AUTO_BACKFILL_FOLLOWS] User/record not found for ${followerDid}: ${msg}`
                );
              } else if (
                hasErrorStatus(error, 400) &&
                msg.includes('Could not find repo')
              ) {
                // Repo doesn't exist (account deleted/suspended)
                console.warn(
                  `[AUTO_BACKFILL_FOLLOWS] Repo not found for ${followerDid} (likely deleted/suspended)`
                );
              } else if (
                hasErrorCode(error, 'ECONNREFUSED') ||
                hasErrorCode(error, 'ETIMEDOUT')
              ) {
                // PDS connection issues
                console.error(
                  `[AUTO_BACKFILL_FOLLOWS] PDS connection error for ${followerDid}: ${code}`
                );
              } else {
                // Unexpected error - log full details
                console.error(
                  `[AUTO_BACKFILL_FOLLOWS] Unexpected error fetching follow record from ${followerDid}:`,
                  {
                    message: msg,
                    status,
                    code,
                  }
                );
              }
              failedCount++;
            }
          })
        );

        if (
          (i + CONCURRENT_FETCHES) % 100 === 0 ||
          i + CONCURRENT_FETCHES >= followerDids.length
        ) {
          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Follower progress: ${successCount}/${followerDids.length} (${failedCount} failed)`
          );
        }
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetched ${followersFetched} incoming follower records`
      );
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error backfilling relationships:`,
        error
      );
    }
  }

  /**
   * Backfill profile info for all users related to this user (follows + followers)
   */
  private async backfillProfileInfo(userDid: string): Promise<void> {
    try {
      // Get all related user DIDs (people user follows + people who follow user)
      const relatedDids = await db.execute(
        sql`
          SELECT DISTINCT following_did as did
          FROM ${follows}
          WHERE follower_did = ${userDid}
          UNION
          SELECT DISTINCT follower_did as did
          FROM ${follows}
          WHERE following_did = ${userDid}
        `
      );

      const didsToFetch = relatedDids.rows.map(
        (row) => (row as { did: string }).did
      );

      if (didsToFetch.length === 0) {
        console.log(
          `[AUTO_BACKFILL_FOLLOWS] No related users to fetch profiles for`
        );
        return;
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetching profiles for ${didsToFetch.length} related users`
      );

      // Check which users don't have profile info yet
      const existingUsers = await storage.getUsers(didsToFetch);
      const existingDids = new Set(existingUsers.map((u) => u.did));
      const missingDids = didsToFetch.filter((did) => !existingDids.has(did));

      if (missingDids.length === 0) {
        console.log(
          `[AUTO_BACKFILL_FOLLOWS] All related users already have profiles`
        );
        return;
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetching ${missingDids.length} missing profiles`
      );

      // Note: We use per-PDS agents instead of a global agent
      const eventProcessor = new EventProcessor({ storage });
      eventProcessor.setSkipPdsFetching(true);
      eventProcessor.setSkipDataCollectionCheck(true);

      let fetchedCount = 0;
      let failedCount = 0;

      // Process in batches
      for (let i = 0; i < missingDids.length; i += BATCH_SIZE) {
        const batch = missingDids.slice(i, i + BATCH_SIZE);

        // Fetch in parallel chunks
        const chunks = [];
        for (let j = 0; j < batch.length; j += CONCURRENT_FETCHES) {
          chunks.push(batch.slice(j, j + CONCURRENT_FETCHES));
        }

        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (did: string) => {
              try {
                // Resolve DID to find PDS endpoint
                const { didResolver } = await import('./did-resolver');
                const didDoc = await didResolver.resolveDID(did);

                if (!didDoc) {
                  failedCount++;
                  return;
                }

                // Find PDS service endpoint
                const services = (didDoc as DIDDocument).service || [];
                const pdsService = services.find(
                  (s) =>
                    s.type === 'AtprotoPersonalDataServer' ||
                    s.id === '#atproto_pds'
                );

                if (!pdsService?.serviceEndpoint) {
                  failedCount++;
                  return;
                }

                // Create agent for this specific PDS
                const pdsAgent = new AtpAgent({
                  service: pdsService.serviceEndpoint,
                });

                // Fetch the profile record
                const response = await pdsAgent.com.atproto.repo.getRecord({
                  repo: did,
                  collection: 'app.bsky.actor.profile',
                  rkey: 'self',
                });

                if (!response.data.value) {
                  failedCount++;
                  return;
                }

                // Process the profile
                await eventProcessor.processCommit({
                  repo: did,
                  ops: [
                    {
                      action: 'create',
                      path: 'app.bsky.actor.profile/self',
                      cid: response.data.cid,
                      record: response.data.value as Record<string, unknown>,
                    },
                  ],
                  time: new Date().toISOString(),
                  rev: '',
                } as ATCommitEvent);

                fetchedCount++;

                if (fetchedCount % 100 === 0) {
                  console.log(
                    `[AUTO_BACKFILL_FOLLOWS] Profile progress: ${fetchedCount}/${missingDids.length} (${failedCount} failed)`
                  );
                }
              } catch (error: unknown) {
                const msg = getErrorMessage(error);
                if (hasErrorStatus(error, 404) || msg.includes('not found')) {
                  // Profile doesn't exist, skip silently
                } else {
                  console.error(
                    `[AUTO_BACKFILL_FOLLOWS] Error fetching profile ${did}:`,
                    msg
                  );
                }
                failedCount++;
              }
            })
          );
        }
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Profile backfill complete: ${fetchedCount} fetched, ${failedCount} failed`
      );
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error backfilling profiles:`,
        error
      );
    }
  }

  /**
   * Backfill posts from all users that this user follows
   * Fetches complete timeline for each followed user
   */
  private async backfillFollowedUsersPosts(userDid: string): Promise<void> {
    try {
      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Starting posts backfill for followed users of ${userDid}`
      );

      // Get all users that this user follows
      const followedUsers = await db.execute(
        sql`
          SELECT DISTINCT following_did as did
          FROM ${follows}
          WHERE follower_did = ${userDid}
        `
      );

      const followedDids = followedUsers.rows.map(
        (row) => (row as { did: string }).did
      );

      if (followedDids.length === 0) {
        console.log(
          `[AUTO_BACKFILL_FOLLOWS] User ${userDid} doesn't follow anyone yet`
        );
        return;
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Backfilling posts from ${followedDids.length} followed users`
      );

      const eventProcessor = new EventProcessor({ storage });
      eventProcessor.setSkipPdsFetching(true);
      eventProcessor.setSkipDataCollectionCheck(true);

      const { didResolver } = await import('./did-resolver');
      let totalPostsFetched = 0;
      let usersCompleted = 0;
      let usersFailed = 0;

      // Process each followed user
      for (const followedDid of followedDids) {
        try {
          // Resolve their DID to find their PDS
          const didDoc = await didResolver.resolveDID(followedDid);
          if (!didDoc) {
            usersFailed++;
            continue;
          }

          const services = (didDoc as DIDDocument).service || [];
          const pdsService = services.find(
            (s) =>
              s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
          );

          if (!pdsService?.serviceEndpoint) {
            usersFailed++;
            continue;
          }

          const pdsAgent = new AtpAgent({
            service: pdsService.serviceEndpoint,
          });

          // Fetch their posts (limit to 100 posts per user)
          let postsFetched = 0;
          let cursor: string | undefined;
          const MAX_POSTS_PER_USER = 100;

          do {
            try {
              const response = await pdsAgent.com.atproto.repo.listRecords({
                repo: followedDid,
                collection: 'app.bsky.feed.post',
                limit: 100,
                cursor: cursor,
              });

              // Process each post
              for (const record of response.data.records) {
                // Stop if we've reached the limit for this user
                if (postsFetched >= MAX_POSTS_PER_USER) {
                  break;
                }

                try {
                  const createdAt =
                    ((record.value as Record<string, unknown> | undefined)
                      ?.createdAt as string) || new Date().toISOString();

                  await eventProcessor.processCommit({
                    repo: followedDid,
                    ops: [
                      {
                        action: 'create',
                        path: `app.bsky.feed.post/${record.uri.split('/').pop()}`,
                        cid: record.cid,
                        record: record.value as Record<string, unknown>,
                      },
                    ],
                    time: createdAt,
                    rev: '',
                  } as ATCommitEvent);

                  postsFetched++;
                  totalPostsFetched++;
                } catch (error: unknown) {
                  // Silently skip individual post errors (e.g., duplicates)
                  if (!hasErrorCode(error, '23505')) {
                    console.error(
                      `[AUTO_BACKFILL_FOLLOWS] Error processing post from ${followedDid}:`,
                      getErrorMessage(error)
                    );
                  }
                }
              }

              // Stop pagination if we've hit the limit
              if (postsFetched >= MAX_POSTS_PER_USER) {
                break;
              }

              cursor = response.data.cursor;
            } catch (error: unknown) {
              console.error(
                `[AUTO_BACKFILL_FOLLOWS] Error listing posts for ${followedDid}:`,
                getErrorMessage(error)
              );
              break;
            }
          } while (cursor);

          usersCompleted++;
          console.log(
            `[AUTO_BACKFILL_FOLLOWS] User ${usersCompleted}/${followedDids.length}: Fetched ${postsFetched} posts from ${followedDid}`
          );
        } catch (error: unknown) {
          console.error(
            `[AUTO_BACKFILL_FOLLOWS] Error backfilling posts for ${followedDid}:`,
            getErrorMessage(error)
          );
          usersFailed++;
        }
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Posts backfill complete: ${totalPostsFetched} posts from ${usersCompleted} users (${usersFailed} failed)`
      );
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error in backfillFollowedUsersPosts:`,
        error
      );
    }
  }

  /**
   * Backfill posts from a single user (called when following someone new)
   */
  async backfillNewFollowPosts(followedDid: string): Promise<void> {
    // Check if already backfilling this user
    if (ongoingNewFollowBackfills.has(followedDid)) {
      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Already backfilling posts for ${followedDid}, skipping duplicate request`
      );
      return;
    }

    // Check if recently backfilled (within cooldown period)
    const lastBackfill = recentlyBackfilledUsers.get(followedDid);
    if (lastBackfill) {
      const timeSinceBackfill = Date.now() - lastBackfill;
      if (timeSinceBackfill < NEW_FOLLOW_BACKFILL_COOLDOWN_MS) {
        const minutesRemaining = Math.ceil(
          (NEW_FOLLOW_BACKFILL_COOLDOWN_MS - timeSinceBackfill) / (60 * 1000)
        );
        console.log(
          `[AUTO_BACKFILL_FOLLOWS] User ${followedDid} was backfilled ${Math.floor(timeSinceBackfill / 60000)} minutes ago, skipping (${minutesRemaining}m cooldown remaining)`
        );
        return;
      }
    }

    console.log(
      `[AUTO_BACKFILL_FOLLOWS] Backfilling posts from newly followed user: ${followedDid}`
    );

    // Mark as ongoing
    ongoingNewFollowBackfills.add(followedDid);

    try {
      const eventProcessor = new EventProcessor({ storage });
      eventProcessor.setSkipPdsFetching(true);
      eventProcessor.setSkipDataCollectionCheck(true);

      const { didResolver } = await import('./did-resolver');

      // Resolve their DID to find their PDS
      const didDoc = await didResolver.resolveDID(followedDid);
      if (!didDoc) {
        console.error(
          `[AUTO_BACKFILL_FOLLOWS] Could not resolve DID ${followedDid}`
        );
        return;
      }

      const services = (didDoc as DIDDocument).service || [];
      const pdsService = services.find(
        (s) => s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
      );

      if (!pdsService?.serviceEndpoint) {
        console.error(
          `[AUTO_BACKFILL_FOLLOWS] No PDS endpoint found for ${followedDid}`
        );
        return;
      }

      const pdsAgent = new AtpAgent({
        service: pdsService.serviceEndpoint,
      });

      // Fetch their posts (limit to 100 posts)
      let postsFetched = 0;
      let cursor: string | undefined;
      const MAX_POSTS_PER_USER = 100;

      do {
        try {
          const response = await pdsAgent.com.atproto.repo.listRecords({
            repo: followedDid,
            collection: 'app.bsky.feed.post',
            limit: 100,
            cursor: cursor,
          });

          // Process each post
          for (const record of response.data.records) {
            // Stop if we've reached the limit
            if (postsFetched >= MAX_POSTS_PER_USER) {
              break;
            }

            try {
              const createdAt =
                ((record.value as Record<string, unknown> | undefined)
                  ?.createdAt as string) || new Date().toISOString();

              await eventProcessor.processCommit({
                repo: followedDid,
                ops: [
                  {
                    action: 'create',
                    path: `app.bsky.feed.post/${record.uri.split('/').pop()}`,
                    cid: record.cid,
                    record: record.value as Record<string, unknown>,
                  },
                ],
                time: createdAt,
                rev: '',
              } as ATCommitEvent);

              postsFetched++;
            } catch (error: unknown) {
              // Silently skip duplicates
              if (!hasErrorCode(error, '23505')) {
                console.error(
                  `[AUTO_BACKFILL_FOLLOWS] Error processing post from ${followedDid}:`,
                  getErrorMessage(error)
                );
              }
            }
          }

          // Stop pagination if we've hit the limit
          if (postsFetched >= MAX_POSTS_PER_USER) {
            break;
          }

          cursor = response.data.cursor;
        } catch (error: unknown) {
          console.error(
            `[AUTO_BACKFILL_FOLLOWS] Error listing posts for ${followedDid}:`,
            getErrorMessage(error)
          );
          break;
        }
      } while (cursor);

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetched ${postsFetched} posts from newly followed user ${followedDid}`
      );

      // Record timestamp of successful backfill
      recentlyBackfilledUsers.set(followedDid, Date.now());
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error backfilling new follow posts:`,
        error
      );
    } finally {
      // Always remove from ongoing set
      ongoingNewFollowBackfills.delete(followedDid);
    }
  }
}

// Singleton instance
export const autoBackfillFollowsService = new AutoBackfillFollowsService();
