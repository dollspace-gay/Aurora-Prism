import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PoolMonitor,
  registerPool,
  getMonitor,
  getAllMonitors,
  logAllPoolStatus,
} from '../../server/pool-metrics';

// Mock pool object
function createMockPool(options: {
  max?: number;
  clients?: number;
  idle?: number;
  pending?: number;
}) {
  return {
    options: { max: options.max || 10 },
    _clients: { length: options.clients || 0 },
    _idle: { length: options.idle || 0 },
    _pendingQueue: { length: options.pending || 0 },
  };
}

describe('PoolMonitor', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('collect', () => {
    it('should collect pool metrics', () => {
      const pool = createMockPool({ max: 10, clients: 5, idle: 3, pending: 0 });
      const monitor = new PoolMonitor(pool as any, 'test');

      const metrics = monitor.collect();

      expect(metrics.total).toBe(10);
      expect(metrics.active).toBe(2); // clients - idle
      expect(metrics.idle).toBe(3);
      expect(metrics.waiting).toBe(0);
      expect(metrics.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should store metrics history', () => {
      const pool = createMockPool({ max: 10, clients: 5, idle: 3 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();
      monitor.collect();
      monitor.collect();

      const history = monitor.getHistory();
      expect(history.length).toBe(3);
    });

    it('should limit history to maxHistory', () => {
      const pool = createMockPool({ max: 10, clients: 5, idle: 3 });
      const monitor = new PoolMonitor(pool as any, 'test');

      // Collect more than maxHistory (100)
      for (let i = 0; i < 110; i++) {
        monitor.collect();
      }

      const history = monitor.getHistory();
      expect(history.length).toBe(100);
    });

    it('should warn at warning threshold (80%)', () => {
      const pool = createMockPool({ max: 10, clients: 8, idle: 0 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();

      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('should error at critical threshold (95%)', () => {
      const pool = createMockPool({ max: 10, clients: 10, idle: 0 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();

      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should warn about waiting queries', () => {
      const pool = createMockPool({ max: 10, clients: 5, idle: 3, pending: 5 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();

      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('5 queries waiting')
      );
    });
  });

  describe('getMetrics', () => {
    it('should return null when no metrics collected', () => {
      const pool = createMockPool({ max: 10 });
      const monitor = new PoolMonitor(pool as any, 'test');

      expect(monitor.getMetrics()).toBeNull();
    });

    it('should return latest metrics', () => {
      const pool = createMockPool({ max: 10, clients: 5, idle: 3 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();
      const metrics = monitor.getMetrics();

      expect(metrics).not.toBeNull();
      expect(metrics?.total).toBe(10);
    });
  });

  describe('getHistory', () => {
    it('should return copy of metrics array', () => {
      const pool = createMockPool({ max: 10, clients: 5, idle: 3 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();
      const history1 = monitor.getHistory();
      const history2 = monitor.getHistory();

      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe('getAverages', () => {
    it('should return zeros when no metrics', () => {
      const pool = createMockPool({ max: 10 });
      const monitor = new PoolMonitor(pool as any, 'test');

      const averages = monitor.getAverages();

      expect(averages.avgActive).toBe(0);
      expect(averages.avgIdle).toBe(0);
      expect(averages.avgWaiting).toBe(0);
      expect(averages.maxUtilization).toBe(0);
    });

    it('should calculate averages correctly', () => {
      const pool = createMockPool({ max: 10, clients: 6, idle: 2 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();
      monitor.collect();

      const averages = monitor.getAverages();

      expect(averages.avgActive).toBe(4); // 6 - 2 = 4 active
      expect(averages.avgIdle).toBe(2);
      expect(averages.avgWaiting).toBe(0);
      expect(averages.maxUtilization).toBe(0.4); // 4/10
    });

    it('should filter metrics outside time window', () => {
      vi.useFakeTimers();

      const pool = createMockPool({ max: 10, clients: 5, idle: 3 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();

      // Advance time past the window
      vi.advanceTimersByTime(120000); // 2 minutes

      // With 1 minute window, old data should be excluded
      const averages = monitor.getAverages(60000);
      expect(averages.avgActive).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('startMonitoring', () => {
    it('should start interval and return timer', () => {
      vi.useFakeTimers();

      const pool = createMockPool({ max: 10, clients: 5, idle: 3 });
      const monitor = new PoolMonitor(pool as any, 'test');

      const timer = monitor.startMonitoring(1000);

      expect(timer).toBeDefined();
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Starting monitoring')
      );

      clearInterval(timer);
      vi.useRealTimers();
    });

    it('should collect metrics at interval', () => {
      vi.useFakeTimers();

      const pool = createMockPool({ max: 10, clients: 5, idle: 3 });
      const monitor = new PoolMonitor(pool as any, 'test');

      const timer = monitor.startMonitoring(1000);

      expect(monitor.getHistory().length).toBe(0);

      vi.advanceTimersByTime(1000);
      expect(monitor.getHistory().length).toBe(1);

      vi.advanceTimersByTime(1000);
      expect(monitor.getHistory().length).toBe(2);

      clearInterval(timer);
      vi.useRealTimers();
    });
  });

  describe('logStatus', () => {
    it('should log no metrics message when empty', () => {
      const pool = createMockPool({ max: 10 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.logStatus();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('No metrics available')
      );
    });

    it('should log pool status when metrics exist', () => {
      const pool = createMockPool({ max: 10, clients: 5, idle: 3, pending: 1 });
      const monitor = new PoolMonitor(pool as any, 'test');

      monitor.collect();
      monitor.logStatus();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Pool:')
      );
    });
  });
});

describe('Pool registry functions', () => {
  beforeEach(() => {
    // Clear the monitors map before each test
    const monitors = getAllMonitors();
    monitors.clear();
  });

  describe('registerPool', () => {
    it('should register a pool and return monitor', () => {
      const pool = createMockPool({ max: 10 });
      const monitor = registerPool(pool as any, 'test-pool');

      expect(monitor).toBeInstanceOf(PoolMonitor);
    });

    it('should store monitor in registry', () => {
      const pool = createMockPool({ max: 10 });
      registerPool(pool as any, 'registered-pool');

      expect(getMonitor('registered-pool')).toBeDefined();
    });
  });

  describe('getMonitor', () => {
    it('should return undefined for unregistered pool', () => {
      expect(getMonitor('nonexistent')).toBeUndefined();
    });

    it('should return monitor for registered pool', () => {
      const pool = createMockPool({ max: 10 });
      const registered = registerPool(pool as any, 'my-pool');

      expect(getMonitor('my-pool')).toBe(registered);
    });
  });

  describe('getAllMonitors', () => {
    it('should return empty map initially', () => {
      const monitors = getAllMonitors();
      expect(monitors.size).toBe(0);
    });

    it('should return all registered monitors', () => {
      const pool1 = createMockPool({ max: 10 });
      const pool2 = createMockPool({ max: 20 });

      registerPool(pool1 as any, 'pool1');
      registerPool(pool2 as any, 'pool2');

      const monitors = getAllMonitors();
      expect(monitors.size).toBe(2);
      expect(monitors.has('pool1')).toBe(true);
      expect(monitors.has('pool2')).toBe(true);
    });
  });

  describe('logAllPoolStatus', () => {
    it('should log status header and footer', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logAllPoolStatus();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connection Pool Status')
      );

      consoleSpy.mockRestore();
    });

    it('should log status for all registered pools', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const pool1 = createMockPool({ max: 10, clients: 5, idle: 3 });
      const pool2 = createMockPool({ max: 20, clients: 10, idle: 5 });

      const monitor1 = registerPool(pool1 as any, 'main');
      const monitor2 = registerPool(pool2 as any, 'backfill');

      // Collect metrics so there's data to log
      monitor1.collect();
      monitor2.collect();

      logAllPoolStatus();

      // Should have logged status for both pools
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
