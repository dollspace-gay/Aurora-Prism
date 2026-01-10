/**
 * Record Validation Service
 *
 * Defense-in-depth validation for AT Protocol records from the firehose.
 * Validates record structure and enforces size limits to prevent
 * malformed or malicious records from being processed.
 */

import { z } from 'zod';

// Constants for validation limits
const LIMITS = {
  MAX_TEXT_LENGTH: 3000, // Max characters in post text
  MAX_FACETS: 100, // Max facets per post
  MAX_EMBED_DEPTH: 5, // Max nested embed levels
  MAX_URI_LENGTH: 2048, // Max URI length
  MAX_DID_LENGTH: 256, // Max DID length
  MAX_HANDLE_LENGTH: 253, // Max handle length (DNS limit)
  MAX_DISPLAY_NAME_LENGTH: 640, // Max display name (64 graphemes * ~10 bytes)
  MAX_DESCRIPTION_LENGTH: 2560, // Max description (256 graphemes * ~10 bytes)
  TIMESTAMP_RANGE_YEARS: 10, // +/- years from current time
} as const;

/**
 * Validation result with optional warning messages
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Sanitized/truncated record if valid but modified */
  sanitized?: unknown;
}

/**
 * Check if a timestamp is within acceptable bounds
 */
function isTimestampValid(timestamp: string): boolean {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return false;

    const now = Date.now();
    const rangeMs = LIMITS.TIMESTAMP_RANGE_YEARS * 365.25 * 24 * 60 * 60 * 1000;

    return date.getTime() >= now - rangeMs && date.getTime() <= now + rangeMs;
  } catch {
    return false;
  }
}

/**
 * Count embed depth recursively
 */
function getEmbedDepth(embed: unknown, currentDepth = 0): number {
  if (
    !embed ||
    typeof embed !== 'object' ||
    currentDepth > LIMITS.MAX_EMBED_DEPTH
  ) {
    return currentDepth;
  }

  const embedObj = embed as Record<string, unknown>;

  // Check for nested embeds in various embed types
  if ('record' in embedObj && typeof embedObj.record === 'object') {
    const record = embedObj.record as Record<string, unknown>;
    if ('embeds' in record && Array.isArray(record.embeds)) {
      let maxDepth = currentDepth + 1;
      for (const nested of record.embeds) {
        maxDepth = Math.max(maxDepth, getEmbedDepth(nested, currentDepth + 1));
      }
      return maxDepth;
    }
    if ('embed' in record) {
      return getEmbedDepth(record.embed, currentDepth + 1);
    }
  }

  // recordWithMedia has both record and media
  if ('media' in embedObj) {
    return currentDepth + 1;
  }

  return currentDepth + 1;
}

// Base schemas for common types
const didSchema = z
  .string()
  .max(LIMITS.MAX_DID_LENGTH)
  .regex(/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/);
const uriSchema = z.string().max(LIMITS.MAX_URI_LENGTH);
const cidSchema = z.string().min(1).max(256);
const timestampSchema = z.string().refine(isTimestampValid, {
  message: `Timestamp must be within ${LIMITS.TIMESTAMP_RANGE_YEARS} years of current time`,
});

// Facet schema for rich text (mentions, links, hashtags)
const facetFeatureSchema = z.discriminatedUnion('$type', [
  z.object({
    $type: z.literal('app.bsky.richtext.facet#mention'),
    did: didSchema,
  }),
  z.object({
    $type: z.literal('app.bsky.richtext.facet#link'),
    uri: uriSchema,
  }),
  z.object({
    $type: z.literal('app.bsky.richtext.facet#tag'),
    tag: z.string().max(640),
  }),
]);

const facetSchema = z.object({
  index: z.object({
    byteStart: z.number().int().min(0),
    byteEnd: z.number().int().min(0),
  }),
  features: z.array(facetFeatureSchema).max(10),
});

// Reply reference schema
const replyRefSchema = z.object({
  root: z.object({
    uri: uriSchema,
    cid: cidSchema,
  }),
  parent: z.object({
    uri: uriSchema,
    cid: cidSchema,
  }),
});

// Blob reference schema
const blobRefSchema = z.object({
  $type: z.literal('blob').optional(),
  ref: z
    .object({
      $link: cidSchema,
    })
    .optional(),
  mimeType: z.string().max(256).optional(),
  size: z
    .number()
    .int()
    .min(0)
    .max(50 * 1024 * 1024)
    .optional(), // 50MB max
});

// Image schema for embed validation
const imageSchema = z.object({
  alt: z.string().max(10000).optional(),
  image: blobRefSchema.optional(),
  aspectRatio: z
    .object({
      width: z.number().int().min(1).max(65535),
      height: z.number().int().min(1).max(65535),
    })
    .optional(),
});

// External link embed schema
const externalEmbedSchema = z.object({
  $type: z.literal('app.bsky.embed.external'),
  external: z.object({
    uri: uriSchema,
    title: z.string().max(1000).optional(),
    description: z.string().max(2000).optional(),
    thumb: blobRefSchema.optional(),
  }),
});

// Images embed schema
const imagesEmbedSchema = z.object({
  $type: z.literal('app.bsky.embed.images'),
  images: z.array(imageSchema).max(4),
});

// Record embed schema (quote posts)
const recordEmbedSchema = z.object({
  $type: z.literal('app.bsky.embed.record'),
  record: z.object({
    uri: uriSchema,
    cid: cidSchema,
  }),
});

// Record with media embed schema
const recordWithMediaEmbedSchema = z.object({
  $type: z.literal('app.bsky.embed.recordWithMedia'),
  record: z.object({
    record: z.object({
      uri: uriSchema,
      cid: cidSchema,
    }),
  }),
  media: z.union([
    z.object({
      $type: z.literal('app.bsky.embed.images'),
      images: z.array(imageSchema).max(4),
    }),
    z.object({
      $type: z.literal('app.bsky.embed.external'),
      external: z.object({
        uri: uriSchema,
        title: z.string().max(1000).optional(),
        description: z.string().max(2000).optional(),
        thumb: blobRefSchema.optional(),
      }),
    }),
  ]),
});

// Video embed schema
const videoEmbedSchema = z.object({
  $type: z.literal('app.bsky.embed.video'),
  video: blobRefSchema.optional(),
  captions: z
    .array(
      z.object({
        lang: z.string().max(10),
        file: blobRefSchema,
      })
    )
    .max(10)
    .optional(),
  alt: z.string().max(10000).optional(),
  aspectRatio: z
    .object({
      width: z.number().int().min(1).max(65535),
      height: z.number().int().min(1).max(65535),
    })
    .optional(),
});

// Combined embed schema for posts
const postEmbedSchema = z.union([
  imagesEmbedSchema,
  externalEmbedSchema,
  recordEmbedSchema,
  recordWithMediaEmbedSchema,
  videoEmbedSchema,
]);

// Post record schema (app.bsky.feed.post)
const postRecordSchema = z.object({
  $type: z.literal('app.bsky.feed.post'),
  text: z.string().max(LIMITS.MAX_TEXT_LENGTH),
  createdAt: timestampSchema,
  reply: replyRefSchema.optional(),
  facets: z.array(facetSchema).max(LIMITS.MAX_FACETS).optional(),
  embed: postEmbedSchema.optional(),
  langs: z.array(z.string().max(10)).max(10).optional(),
  labels: z.unknown().optional(), // Self-labels
  tags: z.array(z.string().max(640)).max(8).optional(),
});

// Like record schema (app.bsky.feed.like)
const likeRecordSchema = z.object({
  $type: z.literal('app.bsky.feed.like'),
  subject: z.object({
    uri: uriSchema,
    cid: cidSchema,
  }),
  createdAt: timestampSchema,
});

// Repost record schema (app.bsky.feed.repost)
const repostRecordSchema = z.object({
  $type: z.literal('app.bsky.feed.repost'),
  subject: z.object({
    uri: uriSchema,
    cid: cidSchema,
  }),
  createdAt: timestampSchema,
});

// Follow record schema (app.bsky.graph.follow)
const followRecordSchema = z.object({
  $type: z.literal('app.bsky.graph.follow'),
  subject: didSchema,
  createdAt: timestampSchema,
});

// Block record schema (app.bsky.graph.block)
const blockRecordSchema = z.object({
  $type: z.literal('app.bsky.graph.block'),
  subject: didSchema,
  createdAt: timestampSchema,
});

// List record schema (app.bsky.graph.list)
const listRecordSchema = z.object({
  $type: z.literal('app.bsky.graph.list'),
  purpose: z.string().max(256),
  name: z.string().max(LIMITS.MAX_DISPLAY_NAME_LENGTH),
  description: z.string().max(LIMITS.MAX_DESCRIPTION_LENGTH).optional(),
  descriptionFacets: z.array(facetSchema).max(LIMITS.MAX_FACETS).optional(),
  avatar: blobRefSchema.optional(),
  createdAt: timestampSchema,
});

// List item record schema (app.bsky.graph.listitem)
const listItemRecordSchema = z.object({
  $type: z.literal('app.bsky.graph.listitem'),
  subject: didSchema,
  list: uriSchema,
  createdAt: timestampSchema,
});

// Feed generator record schema (app.bsky.feed.generator)
const feedGeneratorRecordSchema = z.object({
  $type: z.literal('app.bsky.feed.generator'),
  did: didSchema,
  displayName: z.string().max(LIMITS.MAX_DISPLAY_NAME_LENGTH),
  description: z.string().max(LIMITS.MAX_DESCRIPTION_LENGTH).optional(),
  descriptionFacets: z.array(facetSchema).max(LIMITS.MAX_FACETS).optional(),
  avatar: blobRefSchema.optional(),
  acceptsInteractions: z.boolean().optional(),
  createdAt: timestampSchema,
});

// Profile record schema (app.bsky.actor.profile)
const profileRecordSchema = z.object({
  $type: z.literal('app.bsky.actor.profile'),
  displayName: z.string().max(LIMITS.MAX_DISPLAY_NAME_LENGTH).optional(),
  description: z.string().max(LIMITS.MAX_DESCRIPTION_LENGTH).optional(),
  avatar: blobRefSchema.optional(),
  banner: blobRefSchema.optional(),
  labels: z.unknown().optional(),
  pinnedPost: z
    .object({
      uri: uriSchema,
      cid: cidSchema,
    })
    .optional(),
  createdAt: timestampSchema.optional(),
});

/**
 * Record validation service
 */
export class RecordValidationService {
  /**
   * Validate a post record
   */
  validatePost(record: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Schema validation
    const parsed = postRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }

    // Validate embed depth
    if (parsed.data.embed) {
      const depth = getEmbedDepth(parsed.data.embed);
      if (depth > LIMITS.MAX_EMBED_DEPTH) {
        errors.push(
          `Embed depth ${depth} exceeds maximum ${LIMITS.MAX_EMBED_DEPTH}`
        );
      }
    }

    // Validate facet byte ranges
    if (parsed.data.facets && parsed.data.text) {
      const textBytes = Buffer.byteLength(parsed.data.text, 'utf8');
      for (const facet of parsed.data.facets) {
        if (facet.index.byteEnd > textBytes) {
          warnings.push(
            `Facet byteEnd (${facet.index.byteEnd}) exceeds text length (${textBytes})`
          );
        }
        if (facet.index.byteStart >= facet.index.byteEnd) {
          warnings.push(
            `Invalid facet range: ${facet.index.byteStart}-${facet.index.byteEnd}`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a like record
   */
  validateLike(record: unknown): ValidationResult {
    const parsed = likeRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Validate a repost record
   */
  validateRepost(record: unknown): ValidationResult {
    const parsed = repostRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Validate a follow record
   */
  validateFollow(record: unknown): ValidationResult {
    const parsed = followRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Validate a block record
   */
  validateBlock(record: unknown): ValidationResult {
    const parsed = blockRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Validate a list record
   */
  validateList(record: unknown): ValidationResult {
    const parsed = listRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Validate a list item record
   */
  validateListItem(record: unknown): ValidationResult {
    const parsed = listItemRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Validate a feed generator record
   */
  validateFeedGenerator(record: unknown): ValidationResult {
    const parsed = feedGeneratorRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Validate a profile record
   */
  validateProfile(record: unknown): ValidationResult {
    const parsed = profileRecordSchema.safeParse(record);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map(
          (e) => `${e.path.join('.')}: ${e.message}`
        ),
        warnings: [],
      };
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Validate any record based on its $type
   */
  validateRecord(record: unknown): ValidationResult {
    if (!record || typeof record !== 'object') {
      return {
        valid: false,
        errors: ['Record must be an object'],
        warnings: [],
      };
    }

    const recordObj = record as Record<string, unknown>;
    const type = recordObj.$type;

    if (typeof type !== 'string') {
      return {
        valid: false,
        errors: ['Record must have a $type field'],
        warnings: [],
      };
    }

    switch (type) {
      case 'app.bsky.feed.post':
        return this.validatePost(record);
      case 'app.bsky.feed.like':
        return this.validateLike(record);
      case 'app.bsky.feed.repost':
        return this.validateRepost(record);
      case 'app.bsky.graph.follow':
        return this.validateFollow(record);
      case 'app.bsky.graph.block':
        return this.validateBlock(record);
      case 'app.bsky.graph.list':
        return this.validateList(record);
      case 'app.bsky.graph.listitem':
        return this.validateListItem(record);
      case 'app.bsky.feed.generator':
        return this.validateFeedGenerator(record);
      case 'app.bsky.actor.profile':
        return this.validateProfile(record);
      default:
        // Unknown record types pass through with a warning
        return {
          valid: true,
          errors: [],
          warnings: [`Unknown record type: ${type}`],
        };
    }
  }
}

// Export singleton instance
export const recordValidation = new RecordValidationService();
