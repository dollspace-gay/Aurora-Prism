# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/claude-code) when working with code in this repository.

## Project Overview

Aurora-Prism is an AT Protocol App View that ingests data from the Bluesky network, processes events, and serves API endpoints. It uses a multi-worker architecture with Redis Streams for event distribution and PostgreSQL for persistence.

## Common Commands

```bash
# Development
npm install          # Install dependencies
npm run db:push      # Push database schema
npm run dev          # Start development server
npm run check        # Run type checking

# Docker
docker-compose up    # Start full stack (Redis + Postgres + App)
```

## Architecture

### Core Components

- **App Server** (`server/index.ts`, `server/routes.ts`) - Express server, WebSocket endpoints, worker initialization
- **Firehose Ingestion** (`server/services/firehose.ts`) - Worker 0 connects to relay, publishes to Redis
- **Redis Queue** (`server/services/redis-queue.ts`) - Redis Streams for event distribution
- **Event Processor** (`server/services/event-processor.ts`) - Validates and persists events to PostgreSQL
- **Backfill Agents** (`server/services/backfill.ts`, `server/services/repo-backfill.ts`) - Historical data import
- **Maintenance** (`server/services/data-pruning.ts`, `server/services/database-health.ts`) - Cleanup and health checks

### Worker Model

- `PM2_INSTANCES` controls worker count
- Worker 0: Firehose ingestion to Redis
- All workers: Run 5 parallel consumer pipelines each
- Workers identified by `NODE_APP_INSTANCE`/`pm_id`

### Event Flow

1. Firehose connects to `RELAY_URL` and emits events
2. Worker 0 publishes to Redis Stream `firehose:events`
3. All workers consume via `redisQueue.consume()` with parallel pipelines
4. `eventProcessor` validates, writes to PostgreSQL, creates notifications
5. Messages acknowledged via `xack`

## Key Configuration

| Variable | Description |
|----------|-------------|
| `RELAY_URL` | Bluesky relay (default: `wss://bsky.network`) |
| `REDIS_URL` | Redis connection string |
| `DB_POOL_SIZE` | Main database pool size |
| `BACKFILL_DAYS` | 0=off, >0=days cutoff, -1=full history |
| `DATA_RETENTION_DAYS` | 0=keep forever, >0=prune older data |
| `FIREHOSE_ENABLED` | Toggle live ingestion |
| `MAX_CONCURRENT_OPS` | Per-worker processing limit |

## Issue Tracking with Chainlink

This project uses `chainlink` for issue tracking - a simple, lean issue tracker CLI with dependency support, timers, and milestones.

### Quick Reference

```bash
# View issues
chainlink list             # List all open issues
chainlink show <id>        # Show issue details
chainlink ready            # Show issues ready to work on (no open blockers)
chainlink blocked          # List blocked issues
chainlink tree             # Show issues as a tree hierarchy
chainlink next             # Suggest the next issue to work on

# Create and manage
chainlink create           # Create a new issue
chainlink subissue <parent> # Create a subissue under a parent
chainlink update <id>      # Update an issue
chainlink close <id>       # Close an issue
chainlink reopen <id>      # Reopen a closed issue
chainlink delete <id>      # Delete an issue

# Dependencies
chainlink block <id> <blocker>   # Mark issue as blocked by another
chainlink unblock <id> <blocker> # Remove a blocking relationship

# Relations
chainlink relate <id1> <id2>     # Link two related issues
chainlink unrelate <id1> <id2>   # Remove a relation
chainlink related <id>           # List related issues

# Labels
chainlink label <id> <label>     # Add a label to an issue
chainlink unlabel <id> <label>   # Remove a label from an issue

# Comments
chainlink comment <id>           # Add a comment to an issue

# Search
chainlink search "query"         # Search issues by text

# Time tracking
chainlink start <id>             # Start a timer for an issue
chainlink stop                   # Stop the current timer
chainlink timer                  # Show current timer status

# Milestones
chainlink milestone              # Milestone management

# Import/Export
chainlink export                 # Export issues to file
chainlink import                 # Import issues from JSON file
```

### Workflow Tips

- Use `chainlink ready` to see what you can work on next (no blockers)
- Use `chainlink blocked` to identify what's waiting on other work
- Use `chainlink next` to get a suggestion for what to work on
- Use `chainlink tree` to visualize issue hierarchy
- Use `chainlink start <id>` to track time spent on issues

### When Working on Issues

1. Check `chainlink ready` for available work
2. Start timer: `chainlink start <id>`
3. Reference issue ID in commits when relevant
4. Stop timer when done: `chainlink stop`
5. Close when complete: `chainlink close <id>`

## API Endpoints

- `/health`, `/ready` - Health checks
- `/api/database/health` - Database connectivity
- `/ws` - WebSocket dashboard (metrics, events, status)
- `/xrpc/com.atproto.label.subscribeLabels` - Label subscription stream
- `/api/user/backfill` - User-initiated backfill
- `/api/backfill/repo` - Admin repo backfill

## Troubleshooting

- **No events**: Check `FIREHOSE_ENABLED`, Redis connectivity, relay access
- **Duplicate/FK errors**: Expected during reconnection, handled idempotently
- **Backpressure**: Lower `MAX_CONCURRENT_OPS`, increase resources, or scale workers
- **Backfill slow**: Adjust `BACKFILL_DB_POOL_SIZE` or use repo CAR backfill

## Related Documentation

- [README.md](README.md) - Quick start and environment setup
- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) - Production deployment guide
- [WEBDID_SETUP.md](WEBDID_SETUP.md) - Web DID configuration
- [server/config/INSTANCE_MODERATION_GUIDE.md](server/config/INSTANCE_MODERATION_GUIDE.md) - Moderation setup
- [osprey-bridge/README.md](osprey-bridge/README.md) - Osprey integration
