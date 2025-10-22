-- Migration: Add composite index for timeline queries
-- This optimizes queries that sort posts by createdAt DESC and filter by authorDid
-- Typical use case: Fetching user timelines, following feeds, and author post lists

-- Add composite index on posts table for timeline queries
-- The index is ordered by createdAt DESC to support efficient descending timeline queries
CREATE INDEX IF NOT EXISTS idx_posts_created_at_author ON posts (created_at DESC, author_did);

COMMENT ON INDEX idx_posts_created_at_author IS 'Composite index for efficient timeline queries sorting by createdAt DESC and filtering by author_did';

-- Performance note: This index will significantly improve performance for queries like:
-- SELECT * FROM posts WHERE author_did = 'did:plc:xxx' ORDER BY created_at DESC LIMIT 50;
-- And for following feed queries that need to fetch posts from multiple authors sorted by time
