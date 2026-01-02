import { vi } from 'vitest';

/**
 * AT Protocol Test Mocks
 * Provides mocks for DID resolution, PDS clients, auth services, and firehose events
 */

// Mock DID Document
export function createMockDidDocument(did: string, handle?: string) {
  const pdsEndpoint = 'https://pds.example.com';
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    alsoKnownAs: handle ? [`at://${handle}`] : [],
    verificationMethod: [
      {
        id: `${did}#atproto`,
        type: 'Multikey',
        controller: did,
        publicKeyMultibase: 'zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169',
      },
    ],
    service: [
      {
        id: '#atproto_pds',
        type: 'AtprotoPersonalDataServer',
        serviceEndpoint: pdsEndpoint,
      },
    ],
  };
}

// Mock DID Resolver
export function createMockDidResolver() {
  const cache = new Map<string, any>();

  return {
    resolve: vi.fn(async (did: string) => {
      if (cache.has(did)) {
        return cache.get(did);
      }

      // Generate mock document
      const doc = createMockDidDocument(did);
      cache.set(did, doc);
      return doc;
    }),

    resolveHandle: vi.fn(async (handle: string) => {
      // Generate deterministic DID from handle
      const did = `did:plc:${handle.replace(/[^a-z0-9]/gi, '').slice(0, 24).padEnd(24, '0')}`;
      return did;
    }),

    getPdsEndpoint: vi.fn(async (did: string) => {
      return 'https://pds.example.com';
    }),

    // Test helpers
    _cache: cache,
    _setDocument: (did: string, doc: any) => cache.set(did, doc),
    _clear: () => cache.clear(),
  };
}

// Mock PDS Client
export function createMockPdsClient() {
  const records = new Map<string, any>();
  const blobs = new Map<string, Buffer>();

  return {
    // Record operations
    getRecord: vi.fn(async (params: { repo: string; collection: string; rkey: string }) => {
      const key = `${params.repo}/${params.collection}/${params.rkey}`;
      const record = records.get(key);
      if (!record) {
        throw new Error('Record not found');
      }
      return { uri: `at://${key}`, cid: 'bafyreia...', value: record };
    }),

    listRecords: vi.fn(async (params: { repo: string; collection: string; limit?: number }) => {
      const prefix = `${params.repo}/${params.collection}/`;
      const matching: any[] = [];
      records.forEach((value, key) => {
        if (key.startsWith(prefix)) {
          matching.push({ uri: `at://${key}`, cid: 'bafyreia...', value });
        }
      });
      return { records: matching.slice(0, params.limit || 50) };
    }),

    createRecord: vi.fn(async (params: { repo: string; collection: string; record: any; rkey?: string }) => {
      const rkey = params.rkey || Date.now().toString(36);
      const key = `${params.repo}/${params.collection}/${rkey}`;
      records.set(key, params.record);
      return { uri: `at://${key}`, cid: 'bafyreia...' };
    }),

    deleteRecord: vi.fn(async (params: { repo: string; collection: string; rkey: string }) => {
      const key = `${params.repo}/${params.collection}/${params.rkey}`;
      records.delete(key);
    }),

    // Blob operations
    uploadBlob: vi.fn(async (data: Buffer, mimeType: string) => {
      const cid = `bafkrei${Date.now().toString(36)}`;
      blobs.set(cid, data);
      return { blob: { $type: 'blob', ref: { $link: cid }, mimeType, size: data.length } };
    }),

    getBlob: vi.fn(async (params: { did: string; cid: string }) => {
      const blob = blobs.get(params.cid);
      if (!blob) {
        throw new Error('Blob not found');
      }
      return blob;
    }),

    // Repo operations
    describeRepo: vi.fn(async (params: { repo: string }) => {
      return {
        handle: 'user.bsky.social',
        did: params.repo,
        didDoc: createMockDidDocument(params.repo),
        collections: ['app.bsky.feed.post', 'app.bsky.feed.like', 'app.bsky.graph.follow'],
        handleIsCorrect: true,
      };
    }),

    // Test helpers
    _records: records,
    _blobs: blobs,
    _setRecord: (repo: string, collection: string, rkey: string, value: any) => {
      records.set(`${repo}/${collection}/${rkey}`, value);
    },
    _clear: () => {
      records.clear();
      blobs.clear();
    },
  };
}

// Mock Auth Service
export function createMockAuthService() {
  const sessions = new Map<string, { did: string; handle: string; accessJwt: string; refreshJwt: string }>();
  const tokens = new Map<string, string>(); // token -> did

  return {
    createSession: vi.fn(async (identifier: string, password: string) => {
      // Simple mock - accept any password
      const did = identifier.startsWith('did:')
        ? identifier
        : `did:plc:${identifier.replace(/[^a-z0-9]/gi, '').slice(0, 24).padEnd(24, '0')}`;
      const handle = identifier.startsWith('did:') ? 'user.bsky.social' : identifier;

      const accessJwt = `access_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const refreshJwt = `refresh_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const session = { did, handle, accessJwt, refreshJwt };
      sessions.set(accessJwt, session);
      tokens.set(accessJwt, did);
      tokens.set(refreshJwt, did);

      return session;
    }),

    refreshSession: vi.fn(async (refreshJwt: string) => {
      const did = tokens.get(refreshJwt);
      if (!did) {
        throw new Error('Invalid refresh token');
      }

      const accessJwt = `access_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const newRefreshJwt = `refresh_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      tokens.delete(refreshJwt);
      tokens.set(accessJwt, did);
      tokens.set(newRefreshJwt, did);

      return { did, handle: 'user.bsky.social', accessJwt, refreshJwt: newRefreshJwt };
    }),

    deleteSession: vi.fn(async (accessJwt: string) => {
      const session = sessions.get(accessJwt);
      if (session) {
        tokens.delete(session.accessJwt);
        tokens.delete(session.refreshJwt);
        sessions.delete(accessJwt);
      }
    }),

    getSession: vi.fn(async (accessJwt: string) => {
      return sessions.get(accessJwt) || null;
    }),

    validateToken: vi.fn(async (token: string) => {
      return tokens.get(token) || null;
    }),

    // Test helpers
    _sessions: sessions,
    _tokens: tokens,
    _clear: () => {
      sessions.clear();
      tokens.clear();
    },
  };
}

// Mock Express Request
export function createMockRequest(overrides: Partial<any> = {}) {
  return {
    method: 'GET',
    path: '/',
    headers: {},
    cookies: {},
    query: {},
    params: {},
    body: {},
    ip: '127.0.0.1',
    get: vi.fn((header: string) => (overrides.headers as any)?.[header.toLowerCase()]),
    ...overrides,
  };
}

// Mock Express Response
export function createMockResponse() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null,

    status: vi.fn(function(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function(this: any, data: any) {
      this.body = data;
      return this;
    }),
    send: vi.fn(function(this: any, data: any) {
      this.body = data;
      return this;
    }),
    end: vi.fn(function(this: any) {
      return this;
    }),
    setHeader: vi.fn(function(this: any, name: string, value: string) {
      this.headers[name] = value;
      return this;
    }),
    set: vi.fn(function(this: any, name: string, value: string) {
      this.headers[name] = value;
      return this;
    }),
    cookie: vi.fn(function(this: any, name: string, value: string, options?: any) {
      return this;
    }),
    clearCookie: vi.fn(function(this: any, name: string) {
      return this;
    }),
    redirect: vi.fn(function(this: any, url: string) {
      this.statusCode = 302;
      this.headers['Location'] = url;
      return this;
    }),
    type: vi.fn(function(this: any, type: string) {
      this.headers['Content-Type'] = type;
      return this;
    }),
  };

  return res;
}

// Mock Firehose Event
export function createMockFirehoseEvent(type: 'commit' | 'identity' | 'account' | 'handle', overrides: any = {}) {
  const baseEvent = {
    seq: Math.floor(Math.random() * 1000000),
    time: new Date().toISOString(),
    ...overrides,
  };

  switch (type) {
    case 'commit':
      return {
        ...baseEvent,
        $type: 'com.atproto.sync.subscribeRepos#commit',
        repo: overrides.repo || 'did:plc:testuser1234567890abcdef',
        commit: overrides.commit || 'bafyreia...',
        rev: overrides.rev || '3k...',
        since: overrides.since || null,
        blocks: overrides.blocks || new Uint8Array(),
        ops: overrides.ops || [
          {
            action: 'create',
            path: 'app.bsky.feed.post/3k...',
            cid: 'bafyreia...',
          },
        ],
        blobs: overrides.blobs || [],
        rebase: false,
        tooBig: false,
      };

    case 'identity':
      return {
        ...baseEvent,
        $type: 'com.atproto.sync.subscribeRepos#identity',
        did: overrides.did || 'did:plc:testuser1234567890abcdef',
        handle: overrides.handle || 'user.bsky.social',
      };

    case 'account':
      return {
        ...baseEvent,
        $type: 'com.atproto.sync.subscribeRepos#account',
        did: overrides.did || 'did:plc:testuser1234567890abcdef',
        active: overrides.active !== undefined ? overrides.active : true,
        status: overrides.status || 'active',
      };

    case 'handle':
      return {
        ...baseEvent,
        $type: 'com.atproto.sync.subscribeRepos#handle',
        did: overrides.did || 'did:plc:testuser1234567890abcdef',
        handle: overrides.handle || 'user.bsky.social',
      };

    default:
      return baseEvent;
  }
}

// Mock Post Record
export function createMockPostRecord(overrides: any = {}) {
  return {
    $type: 'app.bsky.feed.post',
    text: overrides.text || 'Hello, world!',
    createdAt: overrides.createdAt || new Date().toISOString(),
    langs: overrides.langs || ['en'],
    ...(overrides.reply && {
      reply: {
        root: { uri: overrides.reply.root, cid: 'bafyreia...' },
        parent: { uri: overrides.reply.parent, cid: 'bafyreia...' },
      },
    }),
    ...(overrides.embed && { embed: overrides.embed }),
    ...(overrides.facets && { facets: overrides.facets }),
  };
}

// Mock Like Record
export function createMockLikeRecord(subjectUri: string, subjectCid?: string) {
  return {
    $type: 'app.bsky.feed.like',
    subject: {
      uri: subjectUri,
      cid: subjectCid || 'bafyreia...',
    },
    createdAt: new Date().toISOString(),
  };
}

// Mock Follow Record
export function createMockFollowRecord(subjectDid: string) {
  return {
    $type: 'app.bsky.graph.follow',
    subject: subjectDid,
    createdAt: new Date().toISOString(),
  };
}

// Mock Repost Record
export function createMockRepostRecord(subjectUri: string, subjectCid?: string) {
  return {
    $type: 'app.bsky.feed.repost',
    subject: {
      uri: subjectUri,
      cid: subjectCid || 'bafyreia...',
    },
    createdAt: new Date().toISOString(),
  };
}

// Mock Block Record
export function createMockBlockRecord(subjectDid: string) {
  return {
    $type: 'app.bsky.graph.block',
    subject: subjectDid,
    createdAt: new Date().toISOString(),
  };
}

// Mock Profile Record
export function createMockProfileRecord(overrides: any = {}) {
  return {
    $type: 'app.bsky.actor.profile',
    displayName: overrides.displayName || 'Test User',
    description: overrides.description || 'A test user profile',
    avatar: overrides.avatar || undefined,
    banner: overrides.banner || undefined,
    createdAt: overrides.createdAt || new Date().toISOString(),
  };
}
