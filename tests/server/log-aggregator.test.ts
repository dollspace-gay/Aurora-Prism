import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogAggregator } from '../../server/services/log-aggregator';

describe('LogAggregator', () => {
  let aggregator: LogAggregator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    aggregator?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      aggregator = new LogAggregator();
      expect(aggregator.getAggregatedLogs()).toHaveLength(0);
    });

    it('should accept custom config', () => {
      aggregator = new LogAggregator({
        flushInterval: 5000,
        maxAggregatedLogs: 100,
        enableAggregation: true,
      });
      expect(aggregator.getAggregatedLogs()).toHaveLength(0);
    });

    it('should not start timer when aggregation disabled', () => {
      aggregator = new LogAggregator({ enableAggregation: false });
      aggregator.log('Test message');

      // Should output directly without aggregation
      expect(console.log).toHaveBeenCalledWith('Test message');
    });
  });

  describe('log', () => {
    it('should aggregate similar log messages', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Message about item 1');
      aggregator.log('Message about item 2');

      const logs = aggregator.getAggregatedLogs();
      // Messages differ only by number, so should be aggregated
      expect(logs).toHaveLength(1);
      expect(logs[0].count).toBe(2);
    });

    it('should keep different messages separate', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('First type of message');
      aggregator.log('Second type of message');

      const logs = aggregator.getAggregatedLogs();
      expect(logs).toHaveLength(2);
    });

    it('should normalize DIDs in messages', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Resolved did:plc:abc123');
      aggregator.log('Resolved did:plc:xyz789');

      const logs = aggregator.getAggregatedLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].count).toBe(2);
    });

    it('should normalize URIs in messages', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Processing at://did:plc:abc/post.123');
      aggregator.log('Processing at://did:plc:xyz/post.456');

      const logs = aggregator.getAggregatedLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].count).toBe(2);
    });

    it('should pass through when aggregation disabled', () => {
      aggregator = new LogAggregator({ enableAggregation: false });

      aggregator.log('Direct message');

      expect(console.log).toHaveBeenCalledWith('Direct message');
      expect(aggregator.getAggregatedLogs()).toHaveLength(0);
    });

    it('should evict oldest entry when at capacity', () => {
      aggregator = new LogAggregator({
        enableAggregation: true,
        maxAggregatedLogs: 2,
      });

      aggregator.log('First unique');
      vi.advanceTimersByTime(100);
      aggregator.log('Second unique');
      vi.advanceTimersByTime(100);
      aggregator.log('Third unique');

      const logs = aggregator.getAggregatedLogs();
      expect(logs).toHaveLength(2);
      expect(logs.map((l) => l.message)).not.toContain('First unique');
    });
  });

  describe('warn', () => {
    it('should aggregate warning messages', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.warn('Warning about item 1');
      aggregator.warn('Warning about item 2');

      const logs = aggregator.getAggregatedLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('warn');
      expect(logs[0].count).toBe(2);
    });

    it('should pass through when aggregation disabled', () => {
      aggregator = new LogAggregator({ enableAggregation: false });

      aggregator.warn('Direct warning');

      expect(console.warn).toHaveBeenCalledWith('Direct warning');
    });
  });

  describe('error', () => {
    it('should aggregate error messages', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.error('Error processing item 1');
      aggregator.error('Error processing item 2');

      const logs = aggregator.getAggregatedLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].count).toBe(2);
    });

    it('should pass through when aggregation disabled', () => {
      aggregator = new LogAggregator({ enableAggregation: false });

      aggregator.error('Direct error');

      expect(console.error).toHaveBeenCalledWith('Direct error');
    });
  });

  describe('flush', () => {
    it('should output aggregated logs', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Test log');
      aggregator.warn('Test warn');
      aggregator.error('Test error');

      aggregator.flush();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[LOG_AGGREGATOR] Flushing 3 aggregated log entries')
      );
    });

    it('should clear aggregated logs after flush', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Test message');
      expect(aggregator.getAggregatedLogs()).toHaveLength(1);

      aggregator.flush();

      expect(aggregator.getAggregatedLogs()).toHaveLength(0);
    });

    it('should do nothing when no logs to flush', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.flush();

      // Should not call console.log for the header
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should output count and duration for repeated messages', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Repeated message');
      vi.advanceTimersByTime(5000);
      aggregator.log('Repeated message');

      aggregator.flush();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('(2x over 5s)')
      );
    });

    it('should use appropriate console method for each level', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Info message');
      aggregator.warn('Warning message');
      aggregator.error('Error message');

      aggregator.flush();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[AGGREGATED] Info message')
      );
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[AGGREGATED] Warning message')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[AGGREGATED] Error message')
      );
    });

    it('should sort by count descending', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Once');
      aggregator.log('Twice');
      aggregator.log('Twice');
      aggregator.log('Thrice');
      aggregator.log('Thrice');
      aggregator.log('Thrice');

      const logs = aggregator.getAggregatedLogs();
      aggregator.flush();

      // Most frequent should be output first
      const logCalls = (console.log as any).mock.calls;
      const aggregatedCalls = logCalls.filter((call: string[]) =>
        call[0].includes('[AGGREGATED]')
      );
      expect(aggregatedCalls[0][0]).toContain('Thrice');
    });
  });

  describe('automatic flush', () => {
    it('should flush on interval', () => {
      aggregator = new LogAggregator({
        enableAggregation: true,
        flushInterval: 10000,
      });

      aggregator.log('Test message');

      expect(console.log).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10000);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[LOG_AGGREGATOR]')
      );
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Before update');
      expect(aggregator.getAggregatedLogs()).toHaveLength(1);

      aggregator.updateConfig({ enableAggregation: false });
      aggregator.log('After update');

      // After disabling, log should go directly to console
      expect(console.log).toHaveBeenCalledWith('After update');
    });

    it('should start timer when enabling aggregation', () => {
      aggregator = new LogAggregator({ enableAggregation: false });

      aggregator.updateConfig({ enableAggregation: true });
      aggregator.log('Test');

      expect(aggregator.getAggregatedLogs()).toHaveLength(1);
    });

    it('should stop timer when disabling aggregation', () => {
      aggregator = new LogAggregator({
        enableAggregation: true,
        flushInterval: 1000,
      });

      aggregator.updateConfig({ enableAggregation: false });

      aggregator.log('Test');
      vi.advanceTimersByTime(5000);

      // Timer should be stopped, no automatic flush
      expect(console.log).toHaveBeenCalledTimes(1); // Just the direct log
    });
  });

  describe('destroy', () => {
    it('should flush and stop timer', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Test');

      aggregator.destroy();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[LOG_AGGREGATOR]')
      );
    });
  });

  describe('metadata handling', () => {
    it('should include metadata keys in aggregation key', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Same message', { key1: 'value1' });
      aggregator.log('Same message', { key2: 'value2' });

      const logs = aggregator.getAggregatedLogs();
      // Different metadata keys = different aggregation
      expect(logs).toHaveLength(2);
    });

    it('should aggregate messages with same metadata structure', () => {
      aggregator = new LogAggregator({ enableAggregation: true });

      aggregator.log('Same message', { key: 'value1' });
      aggregator.log('Same message', { key: 'value2' });

      const logs = aggregator.getAggregatedLogs();
      // Same metadata keys = same aggregation
      expect(logs).toHaveLength(1);
      expect(logs[0].count).toBe(2);
    });
  });
});
