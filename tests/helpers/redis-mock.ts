import { vi } from 'vitest';

/**
 * Create a mock Redis client for testing
 */
export function createMockRedis() {
  const store = new Map<string, string>();
  const streams = new Map<
    string,
    Array<{ id: string; fields: Record<string, string> }>
  >();
  const consumerGroups = new Map<string, Set<string>>();

  return {
    // Basic operations
    get: vi.fn((key: string) => Promise.resolve(store.get(key) || null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: vi.fn((key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    exists: vi.fn((key: string) => Promise.resolve(store.has(key) ? 1 : 0)),
    expire: vi.fn(() => Promise.resolve(1)),
    ttl: vi.fn(() => Promise.resolve(-1)),

    // Hash operations
    hget: vi.fn(() => Promise.resolve(null)),
    hset: vi.fn(() => Promise.resolve(1)),
    hdel: vi.fn(() => Promise.resolve(1)),
    hgetall: vi.fn(() => Promise.resolve({})),

    // List operations
    lpush: vi.fn(() => Promise.resolve(1)),
    rpush: vi.fn(() => Promise.resolve(1)),
    lpop: vi.fn(() => Promise.resolve(null)),
    rpop: vi.fn(() => Promise.resolve(null)),
    lrange: vi.fn(() => Promise.resolve([])),
    llen: vi.fn(() => Promise.resolve(0)),

    // Set operations
    sadd: vi.fn(() => Promise.resolve(1)),
    srem: vi.fn(() => Promise.resolve(1)),
    smembers: vi.fn(() => Promise.resolve([])),
    sismember: vi.fn(() => Promise.resolve(0)),

    // Stream operations (for firehose queue)
    xadd: vi.fn((stream: string, id: string, ...fields: string[]) => {
      if (!streams.has(stream)) {
        streams.set(stream, []);
      }
      const fieldObj: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldObj[fields[i]] = fields[i + 1];
      }
      const msgId = id === '*' ? Date.now() + '-0' : id;
      streams.get(stream)!.push({ id: msgId, fields: fieldObj });
      return Promise.resolve(msgId);
    }),
    xread: vi.fn(() => Promise.resolve(null)),
    xreadgroup: vi.fn(() => Promise.resolve(null)),
    xack: vi.fn(() => Promise.resolve(1)),
    xgroup: vi.fn((command: string, stream: string, group: string) => {
      if (command === 'CREATE') {
        if (!consumerGroups.has(stream)) {
          consumerGroups.set(stream, new Set());
        }
        consumerGroups.get(stream)!.add(group);
      }
      return Promise.resolve('OK');
    }),
    xlen: vi.fn((stream: string) =>
      Promise.resolve(streams.get(stream)?.length || 0)
    ),
    xtrim: vi.fn(() => Promise.resolve(0)),
    xinfo: vi.fn(() => Promise.resolve([])),

    // Pub/Sub
    publish: vi.fn(() => Promise.resolve(0)),
    subscribe: vi.fn(() => Promise.resolve()),
    unsubscribe: vi.fn(() => Promise.resolve()),
    on: vi.fn(),

    // Connection
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    quit: vi.fn(() => Promise.resolve()),
    ping: vi.fn(() => Promise.resolve('PONG')),

    // Pipeline/Multi
    pipeline: vi.fn(() => ({
      exec: vi.fn(() => Promise.resolve([])),
      get: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
    })),
    multi: vi.fn(() => ({
      exec: vi.fn(() => Promise.resolve([])),
      get: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
    })),

    // Test helpers
    _store: store,
    _streams: streams,
    _clear: () => {
      store.clear();
      streams.clear();
      consumerGroups.clear();
    },
  };
}

/**
 * Create mock for redis-queue module
 */
export function createMockRedisQueue() {
  const messages: Array<{ type: string; data: any }> = [];
  let consuming = false;

  return {
    publish: vi.fn((type: string, data: any) => {
      messages.push({ type, data });
      return Promise.resolve();
    }),
    consume: vi.fn((_handler: (msg: any) => Promise<void>) => {
      consuming = true;
      // Process any queued messages
      return Promise.resolve();
    }),
    stop: vi.fn(() => {
      consuming = false;
      return Promise.resolve();
    }),
    isConsuming: () => consuming,
    getStats: vi.fn(() => ({
      published: messages.length,
      consumed: 0,
      failed: 0,
    })),

    // Test helpers
    _messages: messages,
    _simulateMessage: async (
      msg: any,
      handler: (msg: any) => Promise<void>
    ) => {
      await handler(msg);
    },
    _clear: () => {
      messages.length = 0;
      consuming = false;
    },
  };
}
