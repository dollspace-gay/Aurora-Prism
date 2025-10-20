/**
 * XRPC Utilities Index
 * Centralized export of all utility modules
 */

// Cache management
export { cacheManager, CacheManager } from './cache';

// Resolvers
export {
  resolveDidDocument,
  getUserPdsEndpoint,
  resolveActor,
} from './resolvers';

// Authentication helpers
export {
  getUserSessionForDid,
  getAuthenticatedDid,
  requireAuthDid,
} from './auth-helpers';

// Error handling
export { handleError } from './error-handler';

// Serializers
export {
  getBaseUrl,
  cidFromBlobJson,
  transformBlobToCdnUrl,
  directCidToCdnUrl,
  transformEmbedUrls,
  maybeAvatar,
  maybeBanner,
  createAuthorViewerState,
  serializePosts,
  serializePostsEnhanced,
} from './serializers';

// Profile builder
export { getProfiles, getAuthenticatedDid as getAuthenticatedDidFromRequest } from './profile-builder';
