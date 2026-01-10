import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('LogCollector', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log', () => {
    it('should add log entry with timestamp and level', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.log('INFO', 'Test message');

      const logs = logCollector.getRecentLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('INFO');
      expect(logs[0].message).toBe('Test message');
      expect(logs[0].timestamp).toBeDefined();
    });

    it('should add log entry with metadata', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.log('INFO', 'Test message', { key: 'value' });

      const logs = logCollector.getRecentLogs();
      expect(logs[0].metadata).toEqual({ key: 'value' });
    });

    it('should prepend new logs (most recent first)', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.log('INFO', 'First');
      logCollector.log('INFO', 'Second');

      const logs = logCollector.getRecentLogs();
      expect(logs[0].message).toBe('Second');
      expect(logs[1].message).toBe('First');
    });

    it('should limit logs to maxLogs (500)', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      for (let i = 0; i < 510; i++) {
        logCollector.log('INFO', `Message ${i}`);
      }

      const logs = logCollector.getRecentLogs(1000);
      expect(logs.length).toBe(500);
      expect(logs[0].message).toBe('Message 509'); // Most recent
    });

    it('should output ERROR to console.error', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.log('ERROR', 'Error message');

      expect(console.error).toHaveBeenCalled();
    });

    it('should output WARNING to console.warn', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.log('WARNING', 'Warning message');

      expect(console.warn).toHaveBeenCalled();
    });

    it('should output INFO to console.log', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.log('INFO', 'Info message');

      expect(console.log).toHaveBeenCalled();
    });

    it('should output SUCCESS to console.log', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.log('SUCCESS', 'Success message');

      expect(console.log).toHaveBeenCalled();
    });

    it('should output EVENT to console.log', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.log('EVENT', 'Event message');

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('convenience methods', () => {
    it('info should log with INFO level', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.info('Info message', { data: 'test' });

      const logs = logCollector.getRecentLogs();
      expect(logs[0].level).toBe('INFO');
      expect(logs[0].message).toBe('Info message');
    });

    it('success should log with SUCCESS level', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.success('Success message');

      const logs = logCollector.getRecentLogs();
      expect(logs[0].level).toBe('SUCCESS');
    });

    it('warning should log with WARNING level', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.warning('Warning message');

      const logs = logCollector.getRecentLogs();
      expect(logs[0].level).toBe('WARNING');
    });

    it('error should log with ERROR level', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.error('Error message');

      const logs = logCollector.getRecentLogs();
      expect(logs[0].level).toBe('ERROR');
    });

    it('event should log with EVENT level', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.event('Event message');

      const logs = logCollector.getRecentLogs();
      expect(logs[0].level).toBe('EVENT');
    });
  });

  describe('getRecentLogs', () => {
    it('should return limited logs based on parameter', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      for (let i = 0; i < 50; i++) {
        logCollector.log('INFO', `Message ${i}`);
      }

      const logs = logCollector.getRecentLogs(10);
      expect(logs.length).toBe(10);
    });

    it('should default to 100 logs', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      for (let i = 0; i < 150; i++) {
        logCollector.log('INFO', `Message ${i}`);
      }

      const logs = logCollector.getRecentLogs();
      expect(logs.length).toBe(100);
    });

    it('should return all logs if less than limit', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');
      logCollector.clear();

      logCollector.log('INFO', 'Only one');

      const logs = logCollector.getRecentLogs(100);
      expect(logs.length).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all logs', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.log('INFO', 'Test');
      logCollector.log('INFO', 'Test2');
      logCollector.clear();

      const logs = logCollector.getRecentLogs();
      expect(logs.length).toBe(0);
    });
  });

  describe('log formatting', () => {
    it('should format log with metadata in JSON', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.info('Message', { key: 'value', count: 42 });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('{"key":"value","count":42}')
      );
    });

    it('should format log without metadata', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.info('Simple message');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Simple message')
      );
    });

    it('should include timestamp in log output', async () => {
      const { logCollector } =
        await import('../../server/services/log-collector');

      logCollector.info('Timestamped message');

      // Check that console.log was called with ISO date format
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      );
    });
  });
});
