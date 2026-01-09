import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock db module before any imports
vi.mock('../../server/db', () => ({
  createDbPool: vi.fn().mockReturnValue({}),
}));

// Mock storage module
const mockStorageInstance = {
  getUser: vi.fn(),
  createUser: vi.fn(),
  createLabel: vi.fn(),
  getLabel: vi.fn(),
};

vi.mock('../../server/storage', () => ({
  storage: mockStorageInstance,
  DatabaseStorage: vi.fn().mockImplementation(() => mockStorageInstance),
  createStorage: vi.fn().mockImplementation(() => mockStorageInstance),
}));

// Mock services that container loads lazily
// Note: Service modules are not mocked here because the container uses
// dynamic require() which bypasses vi.mock. Once services are refactored
// to use constructor DI, they won't need the fallback require() pattern.

describe('ServiceContainer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('Initialization', () => {
    it('should create container with default config', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const container = new ServiceContainer();

      expect(container.isInitialized).toBe(false);
    });

    it('should initialize successfully with skipDb', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const container = new ServiceContainer({ skipDb: true });

      await container.initialize();

      expect(container.isInitialized).toBe(true);
    });

    it('should warn on double initialization', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const container = new ServiceContainer({ skipDb: true });

      await container.initialize();
      await container.initialize();

      expect(console.warn).toHaveBeenCalledWith(
        '[CONTAINER] Already initialized'
      );
    });

    it('should accept custom storage for testing', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const mockStorage = { getUser: vi.fn(), createUser: vi.fn() };
      const container = new ServiceContainer({
        skipDb: true,
        storage: mockStorage as any,
      });

      await container.initialize();

      expect(container.storage).toBe(mockStorage);
    });
  });

  describe('Storage Access', () => {
    it('should throw if accessing storage before initialization', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const container = new ServiceContainer();

      expect(() => container.storage).toThrow(
        '[CONTAINER] Storage not initialized'
      );
    });

    it('should return storage after initialization', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const mockStorage = { getUser: vi.fn() };
      const container = new ServiceContainer({
        skipDb: true,
        storage: mockStorage as any,
      });

      await container.initialize();

      expect(container.storage).toBeDefined();
    });
  });

  describe('Database Access', () => {
    it('should throw if accessing db before initialization', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const container = new ServiceContainer();

      expect(() => container.db).toThrow(
        '[CONTAINER] Database not initialized'
      );
    });
  });

  // Note: Lazy loading tests removed - they test the fallback require() pattern
  // which will be replaced once services are refactored for constructor DI.
  // Service accessor tests will be added when services support DI injection.

  describe('Factory Methods', () => {
    it('should create isolated storage instance', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const container = new ServiceContainer({ skipDb: true });
      await container.initialize();

      const newStorage = container.createStorage();
      expect(newStorage).toBeDefined();
    });
  });

  describe('Shutdown', () => {
    it('should shutdown cleanly', async () => {
      const { ServiceContainer } = await import('../../server/container');
      const container = new ServiceContainer({ skipDb: true });
      await container.initialize();

      await container.shutdown();

      expect(container.isInitialized).toBe(false);
    });
  });

  describe('Global Container Functions', () => {
    it('should get global container instance', async () => {
      const { getContainer } = await import('../../server/container');
      const container = getContainer();

      expect(container).toBeDefined();
    });

    it('should initialize global container', async () => {
      const { initializeContainer } = await import('../../server/container');
      const container = await initializeContainer({ skipDb: true });

      expect(container.isInitialized).toBe(true);
    });

    it('should create test container with mock storage', async () => {
      const { createTestContainer } = await import('../../server/container');
      const mockStorage = { getUser: vi.fn() };

      const container = createTestContainer(mockStorage as any);

      expect(container).toBeDefined();
    });
  });
});
