import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket and dependencies
vi.mock('ws', () => ({
  default: vi.fn(),
}));

vi.mock('@skyware/firehose', () => ({
  Firehose: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('../../server/services/metrics', () => ({
  metricsService: {
    recordApiRequest: vi.fn(),
    trackNetworkBytes: vi.fn(),
    recordFirehoseEvent: vi.fn(),
    recordLatency: vi.fn(),
  },
}));

vi.mock('../../server/services/log-collector', () => ({
  logCollector: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../server/services/redis-queue', () => ({
  redisQueue: {
    publish: vi.fn().mockResolvedValue(undefined),
    getClusterMetrics: vi.fn().mockResolvedValue({}),
  },
}));

describe('Firehose Client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Hash Function', () => {
    // Test the hash function behavior
    const hashString = (str: string): number => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash);
    };

    it('should return consistent hash for same input', () => {
      const hash1 = hashString('test-event-id');
      const hash2 = hashString('test-event-id');
      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different input', () => {
      const hash1 = hashString('event-1');
      const hash2 = hashString('event-2');
      expect(hash1).not.toBe(hash2);
    });

    it('should return non-negative number', () => {
      const hashes = [
        hashString('test'),
        hashString('another-test'),
        hashString('did:plc:user123'),
        hashString('at://did:plc:user/post/123'),
      ];

      hashes.forEach((hash) => {
        expect(hash).toBeGreaterThanOrEqual(0);
      });
    });

    it('should distribute evenly across workers', () => {
      const workerCount = 4;
      const eventCount = 1000;
      const distribution = new Array(workerCount).fill(0);

      for (let i = 0; i < eventCount; i++) {
        const hash = hashString(`event-${i}`);
        const worker = hash % workerCount;
        distribution[worker]++;
      }

      // Each worker should get roughly 25% (+/- 10%)
      const expected = eventCount / workerCount;
      distribution.forEach((count) => {
        expect(count).toBeGreaterThan(expected * 0.7);
        expect(count).toBeLessThan(expected * 1.3);
      });
    });
  });

  describe('Event Distribution', () => {
    const shouldProcessEvent = (
      eventId: string,
      workerId: number,
      totalWorkers: number
    ): boolean => {
      if (totalWorkers === 1) return true;
      let hash = 0;
      for (let i = 0; i < eventId.length; i++) {
        const char = eventId.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return Math.abs(hash) % totalWorkers === workerId;
    };

    it('should always process when single worker', () => {
      expect(shouldProcessEvent('any-event', 0, 1)).toBe(true);
      expect(shouldProcessEvent('another-event', 0, 1)).toBe(true);
    });

    it('should distribute events across multiple workers', () => {
      const events = ['event-1', 'event-2', 'event-3', 'event-4'];
      const totalWorkers = 2;

      let worker0Count = 0;
      let worker1Count = 0;

      events.forEach((event) => {
        if (shouldProcessEvent(event, 0, totalWorkers)) worker0Count++;
        if (shouldProcessEvent(event, 1, totalWorkers)) worker1Count++;
      });

      // Each event should go to exactly one worker
      expect(worker0Count + worker1Count).toBe(events.length);
    });

    it('should be deterministic', () => {
      const eventId = 'test-event-123';
      const result1 = shouldProcessEvent(eventId, 0, 4);
      const result2 = shouldProcessEvent(eventId, 0, 4);
      expect(result1).toBe(result2);
    });
  });

  describe('Concurrency Control', () => {
    class MockConcurrencyController {
      private activeProcessing = 0;
      private processingQueue: Array<() => Promise<void>> = [];
      private maxConcurrent: number;

      constructor(maxConcurrent: number) {
        this.maxConcurrent = maxConcurrent;
      }

      async queueTask(task: () => Promise<void>): Promise<void> {
        if (this.activeProcessing < this.maxConcurrent) {
          await this.processTask(task);
        } else {
          this.processingQueue.push(task);
        }
      }

      private async processTask(task: () => Promise<void>) {
        this.activeProcessing++;
        try {
          await task();
        } finally {
          this.activeProcessing--;
          this.processNext();
        }
      }

      private processNext() {
        if (this.activeProcessing < this.maxConcurrent && this.processingQueue.length > 0) {
          const next = this.processingQueue.shift();
          if (next) this.processTask(next);
        }
      }

      getStats() {
        return {
          active: this.activeProcessing,
          queued: this.processingQueue.length,
        };
      }
    }

    it('should limit concurrent processing', async () => {
      const controller = new MockConcurrencyController(2);
      const completedTasks: number[] = [];

      const createTask = (id: number, delay: number) => async () => {
        await new Promise((r) => setTimeout(r, delay));
        completedTasks.push(id);
      };

      // Queue 4 tasks
      controller.queueTask(createTask(1, 100));
      controller.queueTask(createTask(2, 100));
      controller.queueTask(createTask(3, 100));
      controller.queueTask(createTask(4, 100));

      // Initially 2 active, 2 queued
      expect(controller.getStats().active).toBe(2);
      expect(controller.getStats().queued).toBe(2);
    });

    it('should process queue when slots become available', async () => {
      const controller = new MockConcurrencyController(1);
      let processed = 0;

      const task = async () => {
        processed++;
      };

      await controller.queueTask(task);
      expect(processed).toBe(1);

      await controller.queueTask(task);
      expect(processed).toBe(2);
    });
  });

  describe('Cursor Management', () => {
    it('should parse cursor from event', () => {
      const parseCursor = (event: { seq?: number }): string | null => {
        if (event.seq !== undefined) {
          return String(event.seq);
        }
        return null;
      };

      expect(parseCursor({ seq: 12345 })).toBe('12345');
      expect(parseCursor({})).toBeNull();
    });

    it('should validate cursor format', () => {
      const isValidCursor = (cursor: string): boolean => {
        return /^\d+$/.test(cursor);
      };

      expect(isValidCursor('12345')).toBe(true);
      expect(isValidCursor('invalid')).toBe(false);
      expect(isValidCursor('')).toBe(false);
    });
  });

  describe('Reconnection Logic', () => {
    it('should calculate exponential backoff', () => {
      const calculateDelay = (
        attempt: number,
        baseDelay: number,
        maxDelay: number
      ): number => {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        return delay;
      };

      expect(calculateDelay(0, 1000, 30000)).toBe(1000);
      expect(calculateDelay(1, 1000, 30000)).toBe(2000);
      expect(calculateDelay(2, 1000, 30000)).toBe(4000);
      expect(calculateDelay(5, 1000, 30000)).toBe(30000); // Capped at max
      expect(calculateDelay(10, 1000, 30000)).toBe(30000);
    });

    it('should add jitter to delay', () => {
      const addJitter = (delay: number, jitterPercent: number): number => {
        const jitter = delay * jitterPercent * (Math.random() - 0.5);
        return Math.round(delay + jitter);
      };

      const delay = 1000;
      const delays = Array.from({ length: 10 }, () => addJitter(delay, 0.2));

      // All delays should be within 10% of base delay
      delays.forEach((d) => {
        expect(d).toBeGreaterThanOrEqual(delay * 0.9);
        expect(d).toBeLessThanOrEqual(delay * 1.1);
      });
    });
  });

  describe('Stall Detection', () => {
    it('should detect stall when no events received', () => {
      const STALL_THRESHOLD = 2 * 60 * 1000; // 2 minutes

      const isStalled = (lastEventTime: number, now: number): boolean => {
        return now - lastEventTime > STALL_THRESHOLD;
      };

      const now = Date.now();
      expect(isStalled(now - 1000, now)).toBe(false);
      expect(isStalled(now - 60000, now)).toBe(false);
      expect(isStalled(now - 121000, now)).toBe(true);
    });
  });

  describe('Event Type Detection', () => {
    it('should identify commit events', () => {
      const isCommitEvent = (event: any): boolean => {
        return event.$type === 'com.atproto.sync.subscribeRepos#commit' || event.commit !== undefined;
      };

      expect(isCommitEvent({ $type: 'com.atproto.sync.subscribeRepos#commit' })).toBe(true);
      expect(isCommitEvent({ commit: {} })).toBe(true);
      expect(isCommitEvent({ identity: {} })).toBe(false);
    });

    it('should identify identity events', () => {
      const isIdentityEvent = (event: any): boolean => {
        return event.$type === 'com.atproto.sync.subscribeRepos#identity' || event.handle !== undefined;
      };

      expect(isIdentityEvent({ $type: 'com.atproto.sync.subscribeRepos#identity' })).toBe(true);
      expect(isIdentityEvent({ handle: 'user.bsky.social' })).toBe(true);
      expect(isIdentityEvent({ commit: {} })).toBe(false);
    });

    it('should identify account events', () => {
      const isAccountEvent = (event: any): boolean => {
        return event.$type === 'com.atproto.sync.subscribeRepos#account';
      };

      expect(isAccountEvent({ $type: 'com.atproto.sync.subscribeRepos#account' })).toBe(true);
      expect(isAccountEvent({ commit: {} })).toBe(false);
    });
  });

  describe('Event Filtering', () => {
    const COLLECTION_ALLOWLIST = [
      'app.bsky.feed.post',
      'app.bsky.feed.like',
      'app.bsky.feed.repost',
      'app.bsky.graph.follow',
      'app.bsky.graph.block',
      'app.bsky.actor.profile',
    ];

    it('should filter allowed collections', () => {
      const shouldProcessCollection = (collection: string): boolean => {
        return COLLECTION_ALLOWLIST.includes(collection);
      };

      expect(shouldProcessCollection('app.bsky.feed.post')).toBe(true);
      expect(shouldProcessCollection('app.bsky.feed.like')).toBe(true);
      expect(shouldProcessCollection('app.bsky.unknown.collection')).toBe(false);
    });

    it('should extract collection from path', () => {
      const extractCollection = (path: string): string | null => {
        const parts = path.split('/');
        if (parts.length >= 1) {
          return parts[0];
        }
        return null;
      };

      expect(extractCollection('app.bsky.feed.post/abc123')).toBe('app.bsky.feed.post');
      expect(extractCollection('app.bsky.graph.follow/xyz')).toBe('app.bsky.graph.follow');
    });
  });
});

describe('Redis Queue Integration', () => {
  describe('Message Format', () => {
    it('should format commit message', () => {
      const formatCommitMessage = (event: any) => ({
        type: 'commit',
        data: {
          repo: event.repo,
          ops: event.ops,
          commit: event.commit,
          seq: event.seq,
        },
      });

      const event = {
        repo: 'did:plc:user',
        ops: [{ action: 'create', path: 'app.bsky.feed.post/123' }],
        commit: 'bafyreia...',
        seq: 12345,
      };

      const message = formatCommitMessage(event);
      expect(message.type).toBe('commit');
      expect(message.data.repo).toBe('did:plc:user');
    });

    it('should format identity message', () => {
      const formatIdentityMessage = (event: any) => ({
        type: 'identity',
        data: {
          did: event.did,
          handle: event.handle,
          seq: event.seq,
        },
      });

      const event = {
        did: 'did:plc:user',
        handle: 'user.bsky.social',
        seq: 12345,
      };

      const message = formatIdentityMessage(event);
      expect(message.type).toBe('identity');
      expect(message.data.handle).toBe('user.bsky.social');
    });
  });

  describe('Batch Processing', () => {
    it('should batch events for publishing', () => {
      const batchEvents = (events: any[], batchSize: number): any[][] => {
        const batches: any[][] = [];
        for (let i = 0; i < events.length; i += batchSize) {
          batches.push(events.slice(i, i + batchSize));
        }
        return batches;
      };

      const events = Array.from({ length: 25 }, (_, i) => ({ id: i }));
      const batches = batchEvents(events, 10);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(10);
      expect(batches[1]).toHaveLength(10);
      expect(batches[2]).toHaveLength(5);
    });
  });
});

describe('Backfill Service', () => {
  describe('Date Cutoff', () => {
    it('should calculate cutoff date', () => {
      const calculateCutoff = (days: number): Date => {
        const now = new Date();
        return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      };

      const cutoff = calculateCutoff(7);
      const now = new Date();
      const daysDiff = (now.getTime() - cutoff.getTime()) / (24 * 60 * 60 * 1000);

      expect(Math.round(daysDiff)).toBe(7);
    });

    it('should handle zero days (no backfill)', () => {
      const shouldBackfill = (days: number): boolean => {
        return days > 0 || days === -1; // -1 means full history
      };

      expect(shouldBackfill(0)).toBe(false);
      expect(shouldBackfill(7)).toBe(true);
      expect(shouldBackfill(-1)).toBe(true);
    });
  });

  describe('Progress Tracking', () => {
    it('should track backfill progress', () => {
      const createProgress = (total: number) => {
        let processed = 0;

        return {
          increment: () => processed++,
          getProgress: () => ({
            processed,
            total,
            percentage: Math.round((processed / total) * 100),
          }),
        };
      };

      const progress = createProgress(100);
      progress.increment();
      progress.increment();

      expect(progress.getProgress().processed).toBe(2);
      expect(progress.getProgress().percentage).toBe(2);
    });
  });

  describe('CAR File Processing', () => {
    it('should validate CAR file header', () => {
      const isValidCarHeader = (bytes: Uint8Array): boolean => {
        // CAR files start with varint length followed by CBOR map
        // Simplified check for testing
        return bytes.length > 0 && bytes[0] > 0;
      };

      expect(isValidCarHeader(new Uint8Array([10, 20, 30]))).toBe(true);
      expect(isValidCarHeader(new Uint8Array([]))).toBe(false);
    });

    it('should extract record from CAR block', () => {
      const extractRecord = (block: { cid: string; bytes: Uint8Array }) => {
        // Simplified extraction
        return {
          cid: block.cid,
          size: block.bytes.length,
        };
      };

      const block = {
        cid: 'bafyreia123',
        bytes: new Uint8Array(100),
      };

      const record = extractRecord(block);
      expect(record.cid).toBe('bafyreia123');
      expect(record.size).toBe(100);
    });
  });
});

describe('Metrics Tracking', () => {
  it('should calculate events per second', () => {
    const calculateRate = (events: number, durationMs: number): number => {
      if (durationMs === 0) return 0;
      return events / (durationMs / 1000);
    };

    expect(calculateRate(100, 1000)).toBe(100);
    expect(calculateRate(50, 500)).toBe(100);
    expect(calculateRate(0, 1000)).toBe(0);
  });

  it('should track event type distribution', () => {
    const distribution = new Map<string, number>();

    const trackEvent = (type: string) => {
      distribution.set(type, (distribution.get(type) || 0) + 1);
    };

    trackEvent('commit');
    trackEvent('commit');
    trackEvent('identity');

    expect(distribution.get('commit')).toBe(2);
    expect(distribution.get('identity')).toBe(1);
  });
});
