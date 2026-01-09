/**
 * AT Protocol type definitions for type-safe event processing
 */

/**
 * Blob reference from AT Protocol - can have multiple formats
 */
export interface BlobRef {
  ref?:
    | {
        $link?: string;
        code?: number;
        version?: number;
        multihash?: {
          code: number;
          size?: number;
          digest: Uint8Array | Record<number, number>;
        };
        toString?: () => string;
      }
    | string;
  cid?: string;
  mimeType?: string;
  size?: number;
}

/**
 * AT Protocol embed types
 */
export interface ATEmbed {
  $type?: string;
  external?: {
    uri?: string;
    title?: string;
    description?: string;
    thumb?: BlobRef;
  };
  images?: Array<{
    image?: BlobRef;
    alt?: string;
    aspectRatio?: { width: number; height: number };
  }>;
  record?: {
    uri?: string;
    cid?: string;
  };
  media?: ATEmbed;
  // Video embed properties
  video?: BlobRef;
  thumbnail?: BlobRef;
  aspectRatio?: { width: number; height: number };
  alt?: string;
}

/**
 * AT Protocol post record
 */
export interface ATPostRecord {
  $type?: string;
  text?: string;
  createdAt?: string;
  embed?: ATEmbed;
  reply?: {
    root?: { uri?: string; cid?: string };
    parent?: { uri?: string; cid?: string };
  };
  facets?: Array<{
    index?: { byteStart: number; byteEnd: number };
    features?: Array<{
      $type?: string;
      uri?: string;
      did?: string;
      tag?: string;
    }>;
  }>;
  langs?: string[];
  labels?: {
    $type?: string;
    values?: Array<{ val: string }>;
  };
  tags?: string[];
}

/**
 * AT Protocol profile record
 */
export interface ATProfileRecord {
  $type?: string;
  displayName?: string;
  description?: string;
  avatar?: BlobRef;
  banner?: BlobRef;
  labels?: {
    $type?: string;
    values?: Array<{ val: string }>;
  };
  createdAt?: string;
  pinnedPost?: { uri?: string; cid?: string };
}

/**
 * AT Protocol firehose commit operation
 */
export interface ATCommitOp {
  action: 'create' | 'update' | 'delete';
  path: string;
  cid?: string | { toString(): string };
  record?: Record<string, unknown>;
}

/**
 * AT Protocol firehose commit event
 */
export interface ATCommitEvent {
  repo: string;
  ops: ATCommitOp[];
  time: string;
  rev?: string;
  seq?: number;
  tooBig?: boolean;
  commit?: {
    cid?: string | { toString(): string };
    rev?: string;
  };
  blobs?: Array<{
    cid?: string | { toString(): string };
    mimeType?: string;
    size?: number;
  }>;
}

/**
 * DID Document from resolution
 */
export interface DIDDocument {
  id?: string;
  alsoKnownAs?: string[];
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
  }>;
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

/**
 * Redis stream message format
 */
export interface RedisStreamMessage {
  id: string;
  fields: Record<string, string>;
}

/**
 * Type guard for checking if a value has an error-like shape
 */
export function isErrorLike(value: unknown): value is { message: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'message' in value &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

/**
 * Type guard for HTTP errors with status
 */
export function isHttpError(
  value: unknown
): value is { status: number; message?: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'status' in value &&
    typeof (value as Record<string, unknown>).status === 'number'
  );
}

/**
 * Safely get string property from unknown object
 */
export function getStringProp(obj: unknown, key: string): string | undefined {
  if (obj !== null && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}
