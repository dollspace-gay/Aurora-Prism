# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Migrate TailwindCSS from v3 to v4 (#55)
- Migrate Vite from v6 to v7 (#53)
- Migrate Express from v4 to v5 (#52)
- Migrate React from v18 to v19 (#51)
- Migrate Zod from v3 to v4 (#54)
- Evaluate major version upgrade for @neondatabase/serverless (#50)
- Migrate Recharts from v2 to v3 (#57)
- Migrate react-day-picker from v8 to v9 (#59)
- Migrate react-resizable-panels from v2 to v4 (#60)
- Migrate date-fns from v3 to v4 (#56)
- Investigate and update AT Protocol packages to latest versions (#48)
- Investigate potentially unused dependencies (#49)
- Update safe dependencies (Radix UI, TailwindCSS, ESLint, TanStack) (#47)
- Comprehensive test suite with 1028 tests covering all major components
- Test coverage for: routes, storage, event-processor, XRPC services, hydration, serializers, views, security, sanitization, encryption, metrics, rate-limiting, caching, and more
- Chainlink issue tracking system for development workflow
- ESLint flat config with TypeScript, React, and Prettier integration
- Vitest configuration for unit and integration testing
- Background jobs system for session cleanup, OAuth cleanup, and pool status logging
- Database health monitoring service
- Data pruning service with configurable retention policies
- Smart console wrapper with log aggregation

### Fixed
- Fix tainted format string patterns in console logging across all server files (#64)
- Event array memory growth in dashboard (unbounded array issue)
- `pendingOp` variable undefined error in BoundedArrayMap
- Profile cache (pfp) not updating correctly
- Preferences endpoint not working properly
- Backfill issues for follows and posts
- Resolver endpoint resolution failures
- Feed generator client authentication issues
- Nuclear block handling (now properly enforced)
- getAuthorFeed error responses
- CORS configuration for ATProto compliance
- User backfill triggering on profile view
- Quote post display issues
- List endpoint pagination
- Worker process coordination

### Changed
- Fix all ESLint warnings for production readiness (#14)
- Set up fuzzing and mutation testing with GitHub Actions (#44)
- Implement placeholder data-plane routes (graph, search, notifications, feed-generators) (#43)
- Implement placeholder feed generator queries in data-plane client (#42)
- Implement placeholder notification queries in data-plane client (#41)
- Implement search queries in data-plane client (#40)
- Implement graph queries in data-plane client (#39)
- Implement list-based blocking in views.ts (#38)
- Fix miscellaneous XRPC service type errors (15 errors across 8 files) (#37)
- Fix client-side type errors (api.ts, dashboard.tsx - 5 errors) (#36)
- Fix feed-generator-service.ts type errors (7 errors) (#35)
- Fix post-interaction-service.ts type errors (7 errors) (#34)
- Fix XRPC serializers.ts type errors (7 errors) (#33)
- Fix repo-backfill.ts type errors (8 errors) (#32)
- Fix storage.ts type errors (9 errors) (#31)
- Fix event-processor.ts type errors (11 errors) (#30)
- Fix timeline-service.ts type errors (19 errors) (#29)
- Fix optimized-hydrator.ts type errors (48 errors) (#28)
- Deleted deprecated `server/services/xrpc-api.ts` monolithic file (~1000+ lines)
- Integrated `startBackgroundJobs()` into server startup
- Fixed 32 unused variable warnings across codebase
- Renamed `getProfiles` to `buildProfiles` for clarity in profile-builder
- Refactored XRPC services into modular architecture under `server/services/xrpc/`
- Added composite database index for timeline queries
- Added database transactions to event-processor for data integrity
- Updated package dependencies to latest versions
- Improved ESLint configuration: disabled `no-undef` for TypeScript, added test globals

### Removed
- Unused imports: `gt` from drizzle-orm, `appViewJWTService`, `maybeAvatar`, `transformBlobToCdnUrl`, and various unused schema imports
- Dead code: `PDS_REQUEST_TIMEOUT` constant
- Deprecated XRPC monolithic API file

### Security
- Fix tainted format string patterns in console logging (#63)
- Fix CORS misconfiguration by using cors package without credentials (#62)
- Fix elliptic vulnerability by replacing with @noble/curves (#46)
- Disabled X-Powered-By header to prevent information disclosure
- Added trust proxy configuration for proper IP detection
- Implemented safe JSON body parser with size limits (10MB)
- Added Content-Security-Policy headers
- SSRF protection in PDS endpoint resolution
- URL sanitization in Vite HTML transformation

## [Previous Releases]

### Performance Improvements
- Added BoundedMap and BoundedArrayMap for memory-efficient caching
- Implemented database connection pooling with health monitoring
- Added Redis caching layer for frequently accessed data
- Optimized timeline queries with composite indexes
- Implemented data loader pattern for N+1 query prevention

### Architecture
- Multi-worker architecture with Redis Streams for event distribution
- Modular XRPC service layer with dedicated services for:
  - Actor/Profile operations
  - Feed operations
  - Graph operations (follows, blocks, lists)
  - Moderation operations
  - Notification operations
  - Search operations
  - Starter pack operations
  - Labeler services
- Dependency injection pattern for testability
- Service container for managing dependencies

### ATProto Compliance
- Full XRPC endpoint compatibility
- OAuth 2.0 authentication flow
- Label subscription stream support
- Firehose event processing
- DID resolution and handle verification
- PDS data fetching for on-demand backfill
