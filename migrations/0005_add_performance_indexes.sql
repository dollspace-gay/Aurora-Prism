-- Migration: Add performance-critical composite indexes
-- This addresses bottlenecks identified in feed_items, notifications, and posts tables

-- 1. Drop and recreate feed_items composite index with DESC order
-- The existing index lacks DESC ordering which is critical for timeline queries
DROP INDEX IF EXISTS idx_feed_items_originator_sort;
CREATE INDEX idx_feed_items_originator_sort ON feed_items (originator_did, sort_at DESC);

COMMENT ON INDEX idx_feed_items_originator_sort IS 'Composite index for timeline queries: WHERE originator_did IN (...) ORDER BY sort_at DESC. DESC ordering is critical for performance.';

-- 2. Add composite index for notifications sorted by creation time
-- This optimizes the common pattern of fetching user notifications sorted by time
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications (recipient_did, created_at DESC);

COMMENT ON INDEX idx_notifications_recipient_created IS 'Composite index for notification queries: WHERE recipient_did = ... ORDER BY created_at DESC. Eliminates sort operation.';

-- 3. Add composite index for posts backfill operations
-- This optimizes sequential processing during backfills and replay operations
CREATE INDEX IF NOT EXISTS idx_posts_commit_seq_time ON posts (commit_seq, commit_time) WHERE commit_seq IS NOT NULL;

COMMENT ON INDEX idx_posts_commit_seq_time IS 'Composite partial index for backfill operations that process posts sequentially by commit sequence and time. Partial index only on posts with commit data.';

-- Performance notes:
-- - idx_feed_items_originator_sort: DESC order allows index-only scans for timeline queries
-- - idx_notifications_recipient_created: Eliminates expensive sort operations for notification fetching
-- - idx_posts_commit_seq_time: Partial index saves space by only indexing posts with commit data
