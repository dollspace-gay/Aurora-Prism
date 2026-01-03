/**
 * ServiceContainer - Dependency Injection Container
 *
 * This container manages service instantiation and dependency wiring.
 * Services are created lazily and cached for singleton behavior.
 *
 * Usage:
 *   const container = new ServiceContainer();
 *   await container.initialize();
 *   const storage = container.storage;
 */

import { type DbConnection, createDbPool } from './db';
import { type IStorage, DatabaseStorage, createStorage } from './storage';
import { type LabelService, createLabelService } from './services/label';
import { type ModerationService, createModerationService } from './services/moderation';
import { type EventProcessor, createEventProcessor } from './services/event-processor';

// Forward declarations for service types
// These will be imported as services are refactored
type CacheServiceType = any;
type DidResolverType = any;
type PdsClientType = any;
type FirehoseClientType = any;
type RedisQueueType = any;
type MetricsServiceType = any;
type AuthServiceType = any;

/**
 * Configuration for the service container
 */
export interface ContainerConfig {
  /** Database pool size (default: from env or auto-detect) */
  dbPoolSize?: number;
  /** Label for the database pool (for logging) */
  dbPoolLabel?: string;
  /** Skip database initialization (for testing) */
  skipDb?: boolean;
  /** Custom storage instance (for testing) */
  storage?: IStorage;
}

/**
 * Service Container for dependency injection
 *
 * Manages the lifecycle and dependencies of all services in the application.
 * Services are lazily instantiated on first access and cached.
 */
export class ServiceContainer {
  private _db: DbConnection | null = null;
  private _storage: IStorage | null = null;

  // Service instances (populated as services are refactored)
  private _labelService: LabelService | null = null;
  private _moderationService: ModerationService | null = null;
  private _eventProcessor: EventProcessor | null = null;
  private _cacheService: CacheServiceType | null = null;
  private _didResolver: DidResolverType | null = null;
  private _pdsClient: PdsClientType | null = null;
  private _firehoseClient: FirehoseClientType | null = null;
  private _redisQueue: RedisQueueType | null = null;
  private _metricsService: MetricsServiceType | null = null;
  private _authService: AuthServiceType | null = null;

  private _initialized = false;
  private readonly config: ContainerConfig;

  constructor(config: ContainerConfig = {}) {
    this.config = config;
  }

  /**
   * Initialize the container and create core services
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      console.warn('[CONTAINER] Already initialized');
      return;
    }

    console.log('[CONTAINER] Initializing service container...');

    // Initialize database connection (unless skipped for testing)
    if (!this.config.skipDb) {
      const poolSize = this.config.dbPoolSize ?? parseInt(process.env.DB_POOL_SIZE || '20', 10);
      const poolLabel = this.config.dbPoolLabel ?? 'container';
      this._db = createDbPool(poolSize, poolLabel);
    }

    // Initialize storage (use provided or create new)
    if (this.config.storage) {
      this._storage = this.config.storage;
    } else if (this._db) {
      this._storage = new DatabaseStorage(this._db);
    }

    // Phase 1: Core services (storage is the foundation)
    // These will be wired up as services are refactored to accept DI

    this._initialized = true;
    console.log('[CONTAINER] Service container initialized');
  }

  /**
   * Check if container is initialized
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Get database connection
   * @throws Error if not initialized
   */
  get db(): DbConnection {
    if (!this._db) {
      throw new Error('[CONTAINER] Database not initialized. Call initialize() first.');
    }
    return this._db;
  }

  /**
   * Get storage instance
   * @throws Error if not initialized
   */
  get storage(): IStorage {
    if (!this._storage) {
      throw new Error('[CONTAINER] Storage not initialized. Call initialize() first.');
    }
    return this._storage;
  }

  // ==========================================
  // Service accessors (to be implemented as services are refactored)
  // ==========================================

  /**
   * Get label service (DI-enabled)
   */
  get labelService(): LabelService {
    if (!this._labelService) {
      if (this._storage) {
        // Create with injected storage
        this._labelService = createLabelService(this._storage);
      } else {
        // Fallback to global singleton if container not initialized with storage
        const { labelService } = require('./services/label');
        this._labelService = labelService;
      }
    }
    return this._labelService!;
  }

  /**
   * Get moderation service (DI-enabled)
   */
  get moderationService(): ModerationService {
    if (!this._moderationService) {
      if (this._storage) {
        // Create with injected dependencies
        this._moderationService = createModerationService(this._storage, this.labelService);
      } else {
        // Fallback to global singleton if container not initialized with storage
        const { moderationService } = require('./services/moderation');
        this._moderationService = moderationService;
      }
    }
    return this._moderationService!;
  }

  /**
   * Get event processor (DI-enabled)
   */
  get eventProcessor(): EventProcessor {
    if (!this._eventProcessor) {
      if (this._storage) {
        // Create with injected dependencies
        this._eventProcessor = createEventProcessor({
          storage: this._storage,
          labelService: this.labelService,
        });
      } else {
        // Fallback to global singleton if container not initialized with storage
        const { eventProcessor } = require('./services/event-processor');
        this._eventProcessor = eventProcessor;
      }
    }
    return this._eventProcessor!;
  }

  /**
   * Get cache service (Phase 2)
   */
  get cacheService(): CacheServiceType {
    if (!this._cacheService) {
      const { cacheService } = require('./services/cache');
      this._cacheService = cacheService;
    }
    return this._cacheService;
  }

  /**
   * Get DID resolver (Phase 2)
   */
  get didResolver(): DidResolverType {
    if (!this._didResolver) {
      const { didResolver } = require('./services/did-resolver');
      this._didResolver = didResolver;
    }
    return this._didResolver;
  }

  /**
   * Get PDS client (Phase 2)
   */
  get pdsClient(): PdsClientType {
    if (!this._pdsClient) {
      const { pdsClient } = require('./services/pds-client');
      this._pdsClient = pdsClient;
    }
    return this._pdsClient;
  }

  /**
   * Get firehose client (Phase 2)
   */
  get firehoseClient(): FirehoseClientType {
    if (!this._firehoseClient) {
      const { firehoseClient } = require('./services/firehose');
      this._firehoseClient = firehoseClient;
    }
    return this._firehoseClient;
  }

  /**
   * Get Redis queue (Phase 2)
   */
  get redisQueue(): RedisQueueType {
    if (!this._redisQueue) {
      const { redisQueue } = require('./services/redis-queue');
      this._redisQueue = redisQueue;
    }
    return this._redisQueue;
  }

  /**
   * Get metrics service (Phase 2)
   */
  get metricsService(): MetricsServiceType {
    if (!this._metricsService) {
      const { metricsService } = require('./services/metrics');
      this._metricsService = metricsService;
    }
    return this._metricsService;
  }

  /**
   * Get auth service (Phase 2)
   */
  get authService(): AuthServiceType {
    if (!this._authService) {
      const { authService } = require('./services/auth');
      this._authService = authService;
    }
    return this._authService;
  }

  // ==========================================
  // Factory methods for creating service instances with DI
  // ==========================================

  /**
   * Create a new storage instance with optional custom db connection
   * Useful for creating isolated storage for testing or backfill
   */
  createStorage(dbConnection?: DbConnection): IStorage {
    return createStorage(dbConnection ?? this._db ?? undefined);
  }

  /**
   * Shutdown the container and cleanup resources
   */
  async shutdown(): Promise<void> {
    console.log('[CONTAINER] Shutting down service container...');

    // Cleanup services that need graceful shutdown
    // (Will be implemented as services are refactored)

    this._initialized = false;
    console.log('[CONTAINER] Service container shut down');
  }
}

/**
 * Global container instance (for backwards compatibility during migration)
 * New code should prefer receiving container via DI
 */
let globalContainer: ServiceContainer | null = null;

/**
 * Get or create the global container instance
 * @deprecated Prefer receiving container via dependency injection
 */
export function getContainer(): ServiceContainer {
  if (!globalContainer) {
    globalContainer = new ServiceContainer();
  }
  return globalContainer;
}

/**
 * Initialize the global container
 * @deprecated Prefer creating and managing container explicitly
 */
export async function initializeContainer(config?: ContainerConfig): Promise<ServiceContainer> {
  globalContainer = new ServiceContainer(config);
  await globalContainer.initialize();
  return globalContainer;
}

/**
 * Create a test container with mocked dependencies
 */
export function createTestContainer(mockStorage: IStorage): ServiceContainer {
  return new ServiceContainer({
    skipDb: true,
    storage: mockStorage,
  });
}
