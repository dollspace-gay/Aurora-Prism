/**
 * One-time script to fix future-dated posts in the database
 *
 * This fixes posts that were created with timestamps in the future,
 * which causes them to appear at the top of timelines incorrectly.
 *
 * Run with: npx tsx server/scripts/fix-future-dated-posts.ts
 */

import { db } from '../db';
import { posts, feedItems } from '../../shared/schema';
import { sql } from 'drizzle-orm';

async function fixFutureDatedPosts() {
  console.log('[FIX] Starting fix for future-dated posts...');

  try {
    // Find all posts with createdAt in the future (with 5 min grace period)
    const gracePeriod = sql`INTERVAL '5 minutes'`;
    const futurePosts = await db.execute(sql`
      SELECT uri, "authorDid", "createdAt", "indexedAt", text
      FROM ${posts}
      WHERE "createdAt" > NOW() + ${gracePeriod}
      ORDER BY "createdAt" DESC
    `);

    console.log(`[FIX] Found ${futurePosts.rows.length} future-dated posts`);

    if (futurePosts.rows.length === 0) {
      console.log('[FIX] No future-dated posts found. Nothing to fix.');
      return;
    }

    // Log the posts we're about to fix
    for (const post of futurePosts.rows) {
      console.log(`[FIX] Post: ${post.uri}`);
      console.log(`  Author: ${post.authorDid}`);
      console.log(`  Original createdAt: ${post.createdAt}`);
      console.log(`  Text: ${(post.text as string).substring(0, 100)}...`);
    }

    // Update posts: set createdAt to indexedAt (when we first saw it)
    const updateResult = await db.execute(sql`
      UPDATE ${posts}
      SET "createdAt" = "indexedAt"
      WHERE "createdAt" > NOW() + ${gracePeriod}
    `);

    console.log(`[FIX] Updated ${updateResult.rowCount} posts`);

    // Also update feedItems that reference these posts
    const feedItemsResult = await db.execute(sql`
      UPDATE ${feedItems}
      SET "sortAt" = "createdAt"
      WHERE "originatorDid" IN (
        SELECT "authorDid"
        FROM ${posts}
        WHERE "createdAt" > NOW() + ${gracePeriod}
      )
    `);

    console.log(`[FIX] Updated ${feedItemsResult.rowCount} feed items`);

    console.log('[FIX] ✓ Future-dated posts have been fixed!');
    console.log('[FIX] These posts will now appear in the correct chronological order.');

  } catch (error) {
    console.error('[FIX] Error fixing future-dated posts:', error);
    throw error;
  }
}

// Run the fix
fixFutureDatedPosts()
  .then(() => {
    console.log('[FIX] Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[FIX] Script failed:', error);
    process.exit(1);
  });
