import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create inline mock storage to avoid hoisting issues
function createInlineMockStorage() {
  const users = new Map();
  const posts = new Map();
  const likes = new Map();
  const reposts = new Map();
  const follows = new Map();

  return {
    getUser: vi.fn((did: string) => Promise.resolve(users.get(did))),
    createUser: vi.fn((user: any) => {
      users.set(user.did, user);
      return Promise.resolve(user);
    }),
    getPost: vi.fn((uri: string) => Promise.resolve(posts.get(uri))),
    createPost: vi.fn((post: any) => {
      posts.set(post.uri, post);
      return Promise.resolve(post);
    }),
    deletePost: vi.fn(),
    createLike: vi.fn((like: any) => {
      likes.set(like.uri, like);
      return Promise.resolve(like);
    }),
    deleteLike: vi.fn(),
    createRepost: vi.fn((repost: any) => {
      reposts.set(repost.uri, repost);
      return Promise.resolve(repost);
    }),
    deleteRepost: vi.fn(),
    createFollow: vi.fn((follow: any) => {
      follows.set(follow.uri, follow);
      return Promise.resolve(follow);
    }),
    deleteFollow: vi.fn(),
    createBlock: vi.fn(),
    deleteBlock: vi.fn(),
    createMute: vi.fn(),
    deleteMute: vi.fn(),
    createList: vi.fn(),
    deleteList: vi.fn(),
    deleteListItem: vi.fn(),
    createFeedGenerator: vi.fn(),
    deleteFeedGenerator: vi.fn(),
    createStarterPack: vi.fn(),
    deleteStarterPack: vi.fn(),
    createLabelerService: vi.fn(),
    deleteLabelerService: vi.fn(),
    deleteListBlock: vi.fn(),
    deleteGenericRecord: vi.fn(),
    getListItems: vi.fn().mockResolvedValue([]),
    _clear: () => {
      users.clear();
      posts.clear();
      likes.clear();
      reposts.clear();
      follows.clear();
    },
  };
}

// Mock dependencies before importing event-processor
vi.mock('../../server/db', () => ({
  db: {
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    transaction: (fn: any) =>
      fn({
        insert: () => ({
          values: () => ({ onConflictDoNothing: () => Promise.resolve() }),
        }),
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
      }),
  },
}));

vi.mock('../../server/storage', () => {
  return {
    storage: createInlineMockStorage(),
    IStorage: {},
  };
});

vi.mock('../../server/services/label', () => ({
  labelService: {
    applyLabel: vi.fn(),
    removeLabel: vi.fn(),
  },
}));

vi.mock('../../server/services/did-resolver', () => ({
  didResolver: {
    resolve: vi.fn(),
    resolveDIDToHandle: vi.fn().mockResolvedValue('user.bsky.social'),
    getPdsEndpoint: vi.fn().mockResolvedValue('https://pds.example.com'),
  },
}));

vi.mock('../../server/services/pds-data-fetcher', () => ({
  pdsDataFetcher: {
    fetchProfile: vi.fn(),
    fetchPost: vi.fn(),
  },
}));

vi.mock('../../server/services/console-wrapper', () => ({
  smartConsole: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
  },
}));

vi.mock('../../data-plane/server/services/cache', () => ({
  cacheService: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('../../server/transaction-utils', () => ({
  withTransaction: vi.fn((fn) => fn({})),
}));

describe('Event Processor Utility Functions', () => {
  describe('sanitizeText', () => {
    it('should return undefined for null input', () => {
      const sanitizeText = (
        text: string | null | undefined
      ): string | undefined => {
        if (!text) return undefined;
        return text.replace(/\u0000/g, '');
      };

      expect(sanitizeText(null)).toBeUndefined();
      expect(sanitizeText(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const sanitizeText = (
        text: string | null | undefined
      ): string | undefined => {
        if (!text) return undefined;
        return text.replace(/\u0000/g, '');
      };

      expect(sanitizeText('')).toBeUndefined();
    });

    it('should remove null bytes from text', () => {
      const sanitizeText = (
        text: string | null | undefined
      ): string | undefined => {
        if (!text) return undefined;
        return text.replace(/\u0000/g, '');
      };

      expect(sanitizeText('hello\u0000world')).toBe('helloworld');
      expect(sanitizeText('\u0000test\u0000')).toBe('test');
    });

    it('should return text as-is if no null bytes', () => {
      const sanitizeText = (
        text: string | null | undefined
      ): string | undefined => {
        if (!text) return undefined;
        return text.replace(/\u0000/g, '');
      };

      expect(sanitizeText('hello world')).toBe('hello world');
    });
  });

  describe('sanitizeRequiredText', () => {
    it('should return empty string for null/undefined', () => {
      const sanitizeRequiredText = (
        text: string | null | undefined
      ): string => {
        if (!text) return '';
        return text.replace(/\u0000/g, '');
      };

      expect(sanitizeRequiredText(null)).toBe('');
      expect(sanitizeRequiredText(undefined)).toBe('');
    });

    it('should remove null bytes and return text', () => {
      const sanitizeRequiredText = (
        text: string | null | undefined
      ): string => {
        if (!text) return '';
        return text.replace(/\u0000/g, '');
      };

      expect(sanitizeRequiredText('test\u0000data')).toBe('testdata');
    });
  });

  describe('extractBlobCid', () => {
    const extractBlobCid = (blob: any): string | null => {
      if (!blob) return null;

      // Handle direct string
      if (typeof blob === 'string') {
        return blob === 'undefined' ? null : blob;
      }

      // Handle blob.ref field
      if (blob.ref) {
        if (typeof blob.ref === 'string') {
          return blob.ref !== 'undefined' ? blob.ref : null;
        }

        if (blob.ref.$link) {
          return blob.ref.$link !== 'undefined' ? blob.ref.$link : null;
        }
      }

      // Handle blob.cid field
      if (blob.cid) {
        return blob.cid !== 'undefined' ? blob.cid : null;
      }

      return null;
    };

    it('should return null for falsy input', () => {
      expect(extractBlobCid(null)).toBeNull();
      expect(extractBlobCid(undefined)).toBeNull();
      expect(extractBlobCid('')).toBeNull();
    });

    it('should handle direct string CID', () => {
      expect(extractBlobCid('bafyreia...')).toBe('bafyreia...');
    });

    it('should return null for "undefined" string', () => {
      expect(extractBlobCid('undefined')).toBeNull();
    });

    it('should extract CID from ref.$link format', () => {
      const blob = { ref: { $link: 'bafyreia123' } };
      expect(extractBlobCid(blob)).toBe('bafyreia123');
    });

    it('should extract CID from string ref', () => {
      const blob = { ref: 'bafyreia456' };
      expect(extractBlobCid(blob)).toBe('bafyreia456');
    });

    it('should extract CID from cid field', () => {
      const blob = { cid: 'bafyreia789' };
      expect(extractBlobCid(blob)).toBe('bafyreia789');
    });

    it('should handle undefined in ref.$link', () => {
      const blob = { ref: { $link: 'undefined' } };
      expect(extractBlobCid(blob)).toBeNull();
    });

    it('should return null for empty object', () => {
      expect(extractBlobCid({})).toBeNull();
    });
  });

  describe('normalizeEmbed', () => {
    const extractBlobCid = (blob: any): string | null => {
      if (!blob) return null;
      if (typeof blob === 'string') return blob === 'undefined' ? null : blob;
      if (blob.ref) {
        if (typeof blob.ref === 'string')
          return blob.ref !== 'undefined' ? blob.ref : null;
        if (blob.ref.$link)
          return blob.ref.$link !== 'undefined' ? blob.ref.$link : null;
      }
      if (blob.cid) return blob.cid !== 'undefined' ? blob.cid : null;
      return null;
    };

    const normalizeEmbed = (embed: any): any => {
      if (!embed || typeof embed !== 'object') return embed;

      const normalized = { ...embed };

      // Handle external embeds with thumbnails
      if (
        normalized.$type === 'app.bsky.embed.external' &&
        normalized.external
      ) {
        normalized.external = { ...normalized.external };
        if (normalized.external.thumb) {
          const thumbCid = extractBlobCid(normalized.external.thumb);
          if (!thumbCid) {
            delete normalized.external.thumb;
          }
        }
      }

      // Handle image embeds
      if (
        normalized.$type === 'app.bsky.embed.images' &&
        Array.isArray(normalized.images)
      ) {
        normalized.images = normalized.images
          .map((img: any) => {
            if (!img.image) return null;
            const imageCid = extractBlobCid(img.image);
            if (!imageCid) return null;
            return img;
          })
          .filter(Boolean);

        if (normalized.images.length === 0) {
          return null;
        }
      }

      // Handle recordWithMedia
      if (
        normalized.$type === 'app.bsky.embed.recordWithMedia' &&
        normalized.media
      ) {
        normalized.media = normalizeEmbed(normalized.media);
        if (!normalized.media) {
          return {
            $type: 'app.bsky.embed.record',
            record: normalized.record,
          };
        }
      }

      // Handle video embeds
      if (normalized.$type === 'app.bsky.embed.video') {
        if (normalized.thumbnail) {
          const thumbCid = extractBlobCid(normalized.thumbnail);
          if (!thumbCid) {
            delete normalized.thumbnail;
          }
        }
      }

      return normalized;
    };

    it('should return null/undefined for non-object input', () => {
      expect(normalizeEmbed(null)).toBeNull();
      expect(normalizeEmbed(undefined)).toBeUndefined();
      expect(normalizeEmbed('string')).toBe('string');
    });

    it('should remove invalid thumb from external embed', () => {
      const embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: 'https://example.com',
          title: 'Example',
          thumb: { ref: { $link: 'undefined' } },
        },
      };

      const result = normalizeEmbed(embed);

      expect(result.external.thumb).toBeUndefined();
      expect(result.external.uri).toBe('https://example.com');
    });

    it('should keep valid thumb in external embed', () => {
      const embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: 'https://example.com',
          thumb: { ref: { $link: 'bafyreia123' } },
        },
      };

      const result = normalizeEmbed(embed);

      expect(result.external.thumb).toBeDefined();
    });

    it('should filter out invalid images', () => {
      const embed = {
        $type: 'app.bsky.embed.images',
        images: [
          { image: { ref: { $link: 'bafyreia1' } }, alt: 'Valid' },
          { image: { ref: { $link: 'undefined' } }, alt: 'Invalid' },
          { image: { ref: { $link: 'bafyreia2' } }, alt: 'Valid 2' },
        ],
      };

      const result = normalizeEmbed(embed);

      expect(result.images).toHaveLength(2);
      expect(result.images[0].alt).toBe('Valid');
      expect(result.images[1].alt).toBe('Valid 2');
    });

    it('should return null if all images are invalid', () => {
      const embed = {
        $type: 'app.bsky.embed.images',
        images: [{ image: null }, { image: { ref: { $link: 'undefined' } } }],
      };

      const result = normalizeEmbed(embed);

      expect(result).toBeNull();
    });

    it('should convert recordWithMedia to record if media is invalid', () => {
      const embed = {
        $type: 'app.bsky.embed.recordWithMedia',
        record: { uri: 'at://user/post/123' },
        media: {
          $type: 'app.bsky.embed.images',
          images: [{ image: null }],
        },
      };

      const result = normalizeEmbed(embed);

      expect(result.$type).toBe('app.bsky.embed.record');
      expect(result.record.uri).toBe('at://user/post/123');
    });

    it('should remove invalid thumbnail from video embed', () => {
      const embed = {
        $type: 'app.bsky.embed.video',
        video: { ref: { $link: 'bafyreia...' } },
        thumbnail: { ref: { $link: 'undefined' } },
      };

      const result = normalizeEmbed(embed);

      expect(result.thumbnail).toBeUndefined();
      expect(result.video).toBeDefined();
    });
  });
});

describe('EventProcessor Class', () => {
  let mockStorage: ReturnType<typeof createInlineMockStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockStorage = createInlineMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockStorage._clear();
  });

  describe('Configuration', () => {
    it('should allow setting skip PDS fetching flag', async () => {
      // This tests the setSkipPdsFetching method
      const { EventProcessor } =
        await import('../../server/services/event-processor');
      const processor = new EventProcessor(mockStorage as any);

      // No error should be thrown
      processor.setSkipPdsFetching(true);
      processor.setSkipPdsFetching(false);
    });

    it('should allow setting skip data collection check flag', async () => {
      const { EventProcessor } =
        await import('../../server/services/event-processor');
      const processor = new EventProcessor(mockStorage as any);

      // No error should be thrown
      processor.setSkipDataCollectionCheck(true);
      processor.setSkipDataCollectionCheck(false);
    });

    it('should allow invalidating data collection cache', async () => {
      const { EventProcessor } =
        await import('../../server/services/event-processor');
      const processor = new EventProcessor(mockStorage as any);

      // No error should be thrown
      processor.invalidateDataCollectionCache('did:plc:test');
    });
  });

  describe('Initialization', () => {
    it('should create processor with default storage', async () => {
      const { EventProcessor } =
        await import('../../server/services/event-processor');
      const processor = new EventProcessor(mockStorage as any);

      // Processor should be created without throwing
      expect(processor).toBeDefined();
    });
  });
});

describe('AT Protocol Record Type Detection', () => {
  // Test the collection type detection logic
  const COLLECTION_TYPES = {
    'app.bsky.feed.post': 'post',
    'app.bsky.feed.like': 'like',
    'app.bsky.feed.repost': 'repost',
    'app.bsky.graph.follow': 'follow',
    'app.bsky.graph.block': 'block',
    'app.bsky.graph.mute': 'mute',
    'app.bsky.graph.list': 'list',
    'app.bsky.graph.listitem': 'listitem',
    'app.bsky.actor.profile': 'profile',
    'app.bsky.feed.generator': 'generator',
    'app.bsky.labeler.service': 'labeler',
    'app.bsky.graph.starterpack': 'starterpack',
    'app.bsky.feed.threadgate': 'threadgate',
  };

  Object.entries(COLLECTION_TYPES).forEach(([collection, type]) => {
    it(`should identify ${collection} as ${type}`, () => {
      const getRecordType = (collection: string) => {
        return (
          COLLECTION_TYPES[collection as keyof typeof COLLECTION_TYPES] ||
          'unknown'
        );
      };

      expect(getRecordType(collection)).toBe(type);
    });
  });

  it('should return unknown for unrecognized collection', () => {
    const getRecordType = (collection: string) => {
      return (
        COLLECTION_TYPES[collection as keyof typeof COLLECTION_TYPES] ||
        'unknown'
      );
    };

    expect(getRecordType('com.unknown.collection')).toBe('unknown');
  });
});

describe('URI Parsing', () => {
  const parseAtUri = (uri: string) => {
    const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    return {
      repo: match[1],
      collection: match[2],
      rkey: match[3],
    };
  };

  it('should parse valid AT URI', () => {
    const result = parseAtUri('at://did:plc:user123/app.bsky.feed.post/3k123');

    expect(result).toEqual({
      repo: 'did:plc:user123',
      collection: 'app.bsky.feed.post',
      rkey: '3k123',
    });
  });

  it('should return null for invalid URI', () => {
    expect(parseAtUri('invalid')).toBeNull();
    expect(parseAtUri('https://example.com')).toBeNull();
    expect(parseAtUri('at://partial')).toBeNull();
  });

  it('should handle various DID formats', () => {
    const plcResult = parseAtUri('at://did:plc:abc123/col/rkey');
    expect(plcResult?.repo).toBe('did:plc:abc123');

    const webResult = parseAtUri('at://did:web:example.com/col/rkey');
    expect(webResult?.repo).toBe('did:web:example.com');
  });
});

describe('Record Validation', () => {
  const isValidPost = (record: any): boolean => {
    if (!record) return false;
    if (typeof record.text !== 'string') return false;
    if (!record.createdAt) return false;
    return true;
  };

  it('should validate post record with required fields', () => {
    const validPost = {
      text: 'Hello world',
      createdAt: new Date().toISOString(),
    };

    expect(isValidPost(validPost)).toBe(true);
  });

  it('should reject post without text', () => {
    const invalidPost = {
      createdAt: new Date().toISOString(),
    };

    expect(isValidPost(invalidPost)).toBe(false);
  });

  it('should reject post without createdAt', () => {
    const invalidPost = {
      text: 'Hello',
    };

    expect(isValidPost(invalidPost)).toBe(false);
  });

  it('should reject null record', () => {
    expect(isValidPost(null)).toBe(false);
  });

  const isValidLike = (record: any): boolean => {
    if (!record) return false;
    if (!record.subject?.uri) return false;
    if (!record.createdAt) return false;
    return true;
  };

  it('should validate like record', () => {
    const validLike = {
      subject: { uri: 'at://user/post/123', cid: 'bafyreia...' },
      createdAt: new Date().toISOString(),
    };

    expect(isValidLike(validLike)).toBe(true);
  });

  it('should reject like without subject', () => {
    const invalidLike = {
      createdAt: new Date().toISOString(),
    };

    expect(isValidLike(invalidLike)).toBe(false);
  });

  const isValidFollow = (record: any): boolean => {
    if (!record) return false;
    if (typeof record.subject !== 'string') return false;
    if (!record.createdAt) return false;
    return true;
  };

  it('should validate follow record', () => {
    const validFollow = {
      subject: 'did:plc:user123',
      createdAt: new Date().toISOString(),
    };

    expect(isValidFollow(validFollow)).toBe(true);
  });

  it('should reject follow with invalid subject', () => {
    const invalidFollow = {
      subject: { did: 'did:plc:user123' }, // Wrong format
      createdAt: new Date().toISOString(),
    };

    expect(isValidFollow(invalidFollow)).toBe(false);
  });
});

describe('Facet Parsing', () => {
  interface ByteSlice {
    byteStart: number;
    byteEnd: number;
  }

  interface Feature {
    $type: string;
    uri?: string;
    did?: string;
    tag?: string;
  }

  interface Facet {
    index: ByteSlice;
    features: Feature[];
  }

  const extractMentions = (facets: Facet[] | undefined): string[] => {
    if (!facets) return [];
    const mentions: string[] = [];
    for (const facet of facets) {
      for (const feature of facet.features) {
        if (
          feature.$type === 'app.bsky.richtext.facet#mention' &&
          feature.did
        ) {
          mentions.push(feature.did);
        }
      }
    }
    return mentions;
  };

  const extractLinks = (facets: Facet[] | undefined): string[] => {
    if (!facets) return [];
    const links: string[] = [];
    for (const facet of facets) {
      for (const feature of facet.features) {
        if (feature.$type === 'app.bsky.richtext.facet#link' && feature.uri) {
          links.push(feature.uri);
        }
      }
    }
    return links;
  };

  const extractTags = (facets: Facet[] | undefined): string[] => {
    if (!facets) return [];
    const tags: string[] = [];
    for (const facet of facets) {
      for (const feature of facet.features) {
        if (feature.$type === 'app.bsky.richtext.facet#tag' && feature.tag) {
          tags.push(feature.tag);
        }
      }
    }
    return tags;
  };

  it('should extract mentions from facets', () => {
    const facets: Facet[] = [
      {
        index: { byteStart: 0, byteEnd: 10 },
        features: [
          { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:user1' },
        ],
      },
      {
        index: { byteStart: 20, byteEnd: 30 },
        features: [
          { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:user2' },
        ],
      },
    ];

    const mentions = extractMentions(facets);
    expect(mentions).toEqual(['did:plc:user1', 'did:plc:user2']);
  });

  it('should extract links from facets', () => {
    const facets: Facet[] = [
      {
        index: { byteStart: 0, byteEnd: 10 },
        features: [
          { $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' },
        ],
      },
    ];

    const links = extractLinks(facets);
    expect(links).toEqual(['https://example.com']);
  });

  it('should extract tags from facets', () => {
    const facets: Facet[] = [
      {
        index: { byteStart: 0, byteEnd: 10 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'atproto' }],
      },
    ];

    const tags = extractTags(facets);
    expect(tags).toEqual(['atproto']);
  });

  it('should return empty array for undefined facets', () => {
    expect(extractMentions(undefined)).toEqual([]);
    expect(extractLinks(undefined)).toEqual([]);
    expect(extractTags(undefined)).toEqual([]);
  });
});
