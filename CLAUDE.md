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

## Issue Tracking with bd/beads

This project uses `bd` (beads) for issue tracking - a lightweight tracker with first-class dependency support. Issues are stored locally and synced via git.

### Quick Reference

```bash
# View issues
bd list                    # List all open issues
bd list --all              # Include closed issues
bd show <id>               # Show issue details
bd status                  # Database overview
bd ready                   # Show ready work (no blockers)
bd blocked                 # Show blocked issues

# Create and manage
bd create                  # Create new issue (opens editor)
bd create -t "Title"       # Create with title
bd update <id> -s open     # Update status (open/in-progress/closed)
bd close <id>              # Close issue
bd reopen <id>             # Reopen issue

# Dependencies
bd dep add <id> <blocker>  # Add dependency (id is blocked by blocker)
bd dep rm <id> <blocker>   # Remove dependency
bd show <id>               # Shows dependencies in issue details

# Labels and organization
bd label add <id> <label>  # Add label
bd label rm <id> <label>   # Remove label
bd list -l bug             # Filter by label

# Comments
bd comment <id>            # Add comment (opens editor)
bd comments <id>           # View comments

# Search and filter
bd search "query"          # Text search
bd stale                   # Show stale issues
bd count                   # Count matching issues

# Sync
bd sync                    # Sync with git remote
bd daemon start            # Start background sync daemon
bd info                    # Show database and daemon info
```

### Workflow Tips

- Use `bd ready` to see what you can work on next (no blockers)
- Use `bd blocked` to identify what's waiting on other work
- Run `bd sync` after making changes to share with collaborators
- Use `bd prime` for AI-optimized context when working with Claude

### When Working on Issues

1. Check `bd ready` for available work
2. Update status to in-progress: `bd update <id> -s in-progress`
3. Reference issue ID in commits when relevant
4. Close when done: `bd close <id>`
5. Sync changes: `bd sync`

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
