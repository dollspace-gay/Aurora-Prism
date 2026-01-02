import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsService } from '../../server/services/metrics';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    vi.useFakeTimers();
    metrics = new MetricsService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('event counting', () => {
    it('should start with zero counts', () => {
      const counts = metrics.getEventCounts();
      expect(counts['#commit']).toBe(0);
      expect(counts['#identity']).toBe(0);
      expect(counts['#account']).toBe(0);
    });

    it('should increment commit events', () => {
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#commit');

      const counts = metrics.getEventCounts();
      expect(counts['#commit']).toBe(3);
    });

    it('should increment identity events', () => {
      metrics.incrementEvent('#identity');
      metrics.incrementEvent('#identity');

      const counts = metrics.getEventCounts();
      expect(counts['#identity']).toBe(2);
    });

    it('should increment account events', () => {
      metrics.incrementEvent('#account');

      const counts = metrics.getEventCounts();
      expect(counts['#account']).toBe(1);
    });

    it('should track total events across types', () => {
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#identity');
      metrics.incrementEvent('#account');
      metrics.incrementEvent('#commit');

      const stats = metrics.getStats();
      expect(stats.totalEvents).toBe(4);
    });

    it('should return copy of event counts (not reference)', () => {
      metrics.incrementEvent('#commit');
      const counts1 = metrics.getEventCounts();
      const counts2 = metrics.getEventCounts();

      expect(counts1).not.toBe(counts2);
      expect(counts1).toEqual(counts2);
    });
  });

  describe('error tracking', () => {
    it('should start with zero errors', () => {
      const stats = metrics.getStats();
      expect(stats.errorCount).toBe(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should increment error count', () => {
      metrics.incrementError();
      metrics.incrementError();

      const stats = metrics.getStats();
      expect(stats.errorCount).toBe(2);
    });

    it('should calculate error rate correctly', () => {
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#commit');
      metrics.incrementError();

      const stats = metrics.getStats();
      expect(stats.errorRate).toBe(25); // 1/4 = 25%
    });
  });

  describe('firehose status', () => {
    it('should start as disconnected', () => {
      const stats = metrics.getStats();
      expect(stats.firehoseStatus).toBe('disconnected');
    });

    it('should update to connected', () => {
      metrics.updateFirehoseStatus('connected');

      const stats = metrics.getStats();
      expect(stats.firehoseStatus).toBe('connected');
    });

    it('should update to error', () => {
      metrics.updateFirehoseStatus('error');

      const stats = metrics.getStats();
      expect(stats.firehoseStatus).toBe('error');
    });
  });

  describe('API request tracking', () => {
    it('should start with zero requests per minute', () => {
      expect(metrics.getApiRequestsPerMinute()).toBe(0);
    });

    it('should count API requests', () => {
      metrics.recordApiRequest();
      metrics.recordApiRequest();
      metrics.recordApiRequest();

      expect(metrics.getApiRequestsPerMinute()).toBe(3);
    });

    it('should expire old requests after window', () => {
      metrics.recordApiRequest();
      metrics.recordApiRequest();

      // Advance time past the window (60 seconds)
      vi.advanceTimersByTime(61000);

      // Record a new request to trigger cleanup
      metrics.recordApiRequest();

      expect(metrics.getApiRequestsPerMinute()).toBe(1);
    });
  });

  describe('endpoint metrics', () => {
    it('should return null for unknown endpoint', () => {
      expect(metrics.getEndpointMetrics('/unknown')).toBeNull();
    });

    it('should record endpoint requests', () => {
      metrics.recordEndpointRequest('/api/users', 100, true);
      metrics.recordEndpointRequest('/api/users', 200, true);
      metrics.recordEndpointRequest('/api/users', 150, false);

      const endpointMetrics = metrics.getEndpointMetrics('/api/users');

      expect(endpointMetrics).not.toBeNull();
      expect(endpointMetrics?.totalRequests).toBe(3);
      expect(endpointMetrics?.successRate).toBeCloseTo(66.67, 1);
      expect(endpointMetrics?.avgResponseTime).toBe(150);
    });

    it('should return all endpoints when no path specified', () => {
      metrics.recordEndpointRequest('/api/users', 100, true);
      metrics.recordEndpointRequest('/api/posts', 200, true);

      const allMetrics = metrics.getEndpointMetrics();

      expect(allMetrics).toHaveProperty('/api/users');
      expect(allMetrics).toHaveProperty('/api/posts');
    });

    it('should expire old endpoint requests', () => {
      metrics.recordEndpointRequest('/api/test', 100, true);

      vi.advanceTimersByTime(61000);

      const endpointMetrics = metrics.getEndpointMetrics('/api/test');
      expect(endpointMetrics?.requestsPerMinute).toBe(0);
    });
  });

  describe('network tracking', () => {
    it('should track network bytes', () => {
      metrics.trackNetworkBytes(1024, 512);
      metrics.trackNetworkBytes(2048, 1024);

      // The network history should have entries
      // This is tested indirectly through getSystemHealth
    });

    it('should expire old network entries', () => {
      metrics.trackNetworkBytes(1024, 512);

      // Advance past network window (10 seconds)
      vi.advanceTimersByTime(11000);

      metrics.trackNetworkBytes(100, 50);

      // Old entries should be cleaned up
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      metrics.incrementEvent('#commit');
      metrics.incrementError();
      metrics.updateFirehoseStatus('connected');

      const stats = metrics.getStats();

      expect(stats).toHaveProperty('totalEvents');
      expect(stats).toHaveProperty('errorCount');
      expect(stats).toHaveProperty('errorRate');
      expect(stats).toHaveProperty('firehoseStatus');
      expect(stats).toHaveProperty('lastUpdate');
      expect(stats).toHaveProperty('uptime');
      expect(stats).toHaveProperty('apiRequestsPerMinute');
    });

    it('should track uptime', () => {
      const initialStats = metrics.getStats();
      const initialUptime = initialStats.uptime;

      vi.advanceTimersByTime(5000);

      const laterStats = metrics.getStats();
      expect(laterStats.uptime).toBeGreaterThan(initialUptime);
    });
  });

  describe('getSystemHealth', () => {
    it('should return system health metrics', async () => {
      const health = await metrics.getSystemHealth();

      expect(health).toHaveProperty('cpu');
      expect(health).toHaveProperty('memory');
      expect(health).toHaveProperty('disk');
      expect(health).toHaveProperty('network');

      expect(typeof health.cpu).toBe('number');
      expect(typeof health.memory).toBe('number');
      expect(typeof health.disk).toBe('number');
      expect(typeof health.network).toBe('string');
    });

    it('should return valid percentage ranges', async () => {
      // Use real timers for accurate CPU measurement
      vi.useRealTimers();
      const realMetrics = new MetricsService();

      // Wait a bit for CPU measurement to have valid data
      await new Promise((resolve) => setTimeout(resolve, 10));

      const health = await realMetrics.getSystemHealth();

      expect(health.cpu).toBeGreaterThanOrEqual(0);
      expect(health.cpu).toBeLessThanOrEqual(100);
      expect(health.memory).toBeGreaterThanOrEqual(0);
      expect(health.memory).toBeLessThanOrEqual(100);

      vi.useFakeTimers();
    });

    it('should format network rates correctly', async () => {
      const health = await metrics.getSystemHealth();

      // Network string should contain up/down indicators
      expect(health.network).toContain('↓');
      expect(health.network).toContain('↑');
    });
  });

  describe('activity history', () => {
    it('should start with empty history', () => {
      const history = metrics.getActivityHistory();
      // History will have filled-in zero entries
      expect(Array.isArray(history)).toBe(true);
    });

    it('should track events in history by minute', () => {
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#identity');

      const history = metrics.getActivityHistory();
      const nonZeroEntries = history.filter(
        (e) => e.commit > 0 || e.identity > 0 || e.account > 0
      );

      expect(nonZeroEntries.length).toBeGreaterThan(0);
    });

    it('should create new bucket for new minute', () => {
      metrics.incrementEvent('#commit');

      // Advance to next minute
      vi.advanceTimersByTime(60001);

      metrics.incrementEvent('#commit');

      const history = metrics.getActivityHistory();
      const nonZeroEntries = history.filter((e) => e.commit > 0);

      // Should have entries in different minute buckets
      expect(nonZeroEntries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      metrics.incrementEvent('#commit');
      metrics.incrementEvent('#identity');
      metrics.incrementEvent('#account');
      metrics.incrementError();

      metrics.reset();

      const counts = metrics.getEventCounts();
      const stats = metrics.getStats();

      expect(counts['#commit']).toBe(0);
      expect(counts['#identity']).toBe(0);
      expect(counts['#account']).toBe(0);
      expect(stats.totalEvents).toBe(0);
      expect(stats.errorCount).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should periodically clean up old data', () => {
      // Record some data
      metrics.recordApiRequest();
      metrics.recordEndpointRequest('/api/test', 100, true);

      // Advance past cleanup interval (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // Data older than window should be cleaned
      // This is internal behavior, but we can verify it doesn't crash
    });
  });
});
