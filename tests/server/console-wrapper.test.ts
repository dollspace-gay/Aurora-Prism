import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock log-aggregator before imports
vi.mock('../../server/services/log-aggregator', () => ({
  logAggregator: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('console-wrapper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldAggregateLog', () => {
    it('should return true for DID_RESOLVER timeout messages', async () => {
      const { shouldAggregateLog } = await import(
        '../../server/services/console-wrapper'
      );

      expect(
        shouldAggregateLog('[DID_RESOLVER] Timeout occurred while resolving')
      ).toBe(true);
    });

    it('should return true for DID_RESOLVER network error messages', async () => {
      const { shouldAggregateLog } = await import(
        '../../server/services/console-wrapper'
      );

      expect(
        shouldAggregateLog('[DID_RESOLVER] Network error: connection refused')
      ).toBe(true);
    });

    it('should return true for DID_RESOLVER attempt failed messages', async () => {
      const { shouldAggregateLog } = await import(
        '../../server/services/console-wrapper'
      );

      expect(
        shouldAggregateLog('[DID_RESOLVER] Attempt 3 failed for did:plc:abc')
      ).toBe(true);
    });

    it('should return true for DID_RESOLVER circuit breaker messages', async () => {
      const { shouldAggregateLog } = await import(
        '../../server/services/console-wrapper'
      );

      expect(
        shouldAggregateLog('[DID_RESOLVER] Circuit breaker triggered')
      ).toBe(true);
    });

    it('should return false for regular log messages', async () => {
      const { shouldAggregateLog } = await import(
        '../../server/services/console-wrapper'
      );

      expect(shouldAggregateLog('Regular log message')).toBe(false);
      expect(shouldAggregateLog('[INFO] Server started')).toBe(false);
      expect(shouldAggregateLog('[EVENT_PROCESSOR] Processed batch')).toBe(
        false
      );
    });
  });

  describe('AggregatedConsole', () => {
    it('should pass messages to log aggregator', async () => {
      const { aggregatedConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      aggregatedConsole.log('Test message');

      expect(logAggregator.log).toHaveBeenCalledWith('Test message');
    });

    it('should concatenate arguments', async () => {
      const { aggregatedConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      aggregatedConsole.log('Message', 'arg1', 'arg2');

      expect(logAggregator.log).toHaveBeenCalledWith('Message arg1 arg2');
    });

    it('warn should pass to aggregator warn', async () => {
      const { aggregatedConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      aggregatedConsole.warn('Warning message');

      expect(logAggregator.warn).toHaveBeenCalledWith('Warning message');
    });

    it('error should pass to aggregator error', async () => {
      const { aggregatedConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      aggregatedConsole.error('Error message');

      expect(logAggregator.error).toHaveBeenCalledWith('Error message');
    });

    it('info should pass to aggregator log', async () => {
      const { aggregatedConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      aggregatedConsole.info('Info message');

      expect(logAggregator.log).toHaveBeenCalledWith('Info message');
    });
  });

  describe('SmartConsole', () => {
    it('should aggregate spammy messages', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      smartConsole.log('[DID_RESOLVER] Timeout while resolving');

      expect(logAggregator.log).toHaveBeenCalledWith(
        '[DID_RESOLVER] Timeout while resolving'
      );
    });

    it('should output non-spammy messages directly', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );

      smartConsole.log('Regular message');

      expect(console.log).toHaveBeenCalledWith('Regular message');
    });

    it('should aggregate spammy warnings', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      smartConsole.warn('[DID_RESOLVER] Network error while resolving');

      expect(logAggregator.warn).toHaveBeenCalledWith(
        '[DID_RESOLVER] Network error while resolving'
      );
    });

    it('should output non-spammy warnings directly', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );

      smartConsole.warn('Regular warning');

      expect(console.warn).toHaveBeenCalledWith('Regular warning');
    });

    it('should aggregate spammy errors', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      smartConsole.error('[DID_RESOLVER] Attempt 5 failed');

      expect(logAggregator.error).toHaveBeenCalledWith(
        '[DID_RESOLVER] Attempt 5 failed'
      );
    });

    it('should output non-spammy errors directly', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );

      smartConsole.error('Regular error');

      expect(console.error).toHaveBeenCalledWith('Regular error');
    });

    it('should aggregate spammy info messages', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );
      const { logAggregator } = await import(
        '../../server/services/log-aggregator'
      );

      smartConsole.info('[DID_RESOLVER] Circuit breaker open');

      expect(logAggregator.log).toHaveBeenCalledWith(
        '[DID_RESOLVER] Circuit breaker open'
      );
    });

    it('should output non-spammy info directly', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );

      smartConsole.info('Regular info');

      expect(console.log).toHaveBeenCalledWith('Regular info');
    });

    it('should handle multiple arguments', async () => {
      const { smartConsole } = await import(
        '../../server/services/console-wrapper'
      );

      smartConsole.log('Message with', 'multiple', 'args');

      expect(console.log).toHaveBeenCalledWith('Message with multiple args');
    });
  });
});
