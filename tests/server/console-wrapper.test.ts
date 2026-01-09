import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock log-aggregator before importing
vi.mock('../../server/services/log-aggregator', () => ({
  logAggregator: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  aggregatedConsole,
  smartConsole,
  SmartConsole,
  shouldAggregateLog,
} from '../../server/services/console-wrapper';
import { logAggregator } from '../../server/services/log-aggregator';

describe('console-wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldAggregateLog', () => {
    it('should return true for DID_RESOLVER timeout messages', () => {
      expect(
        shouldAggregateLog('[DID_RESOLVER] Timeout during resolution')
      ).toBe(true);
    });

    it('should return true for DID_RESOLVER network error messages', () => {
      expect(shouldAggregateLog('[DID_RESOLVER] Network error occurred')).toBe(
        true
      );
    });

    it('should return true for DID_RESOLVER attempt failed messages', () => {
      expect(shouldAggregateLog('[DID_RESOLVER] Attempt 3 failed')).toBe(true);
    });

    it('should return true for DID_RESOLVER circuit breaker messages', () => {
      expect(shouldAggregateLog('[DID_RESOLVER] Circuit breaker tripped')).toBe(
        true
      );
    });

    it('should return false for regular log messages', () => {
      expect(shouldAggregateLog('Regular message')).toBe(false);
    });

    it('should return false for other prefixed messages', () => {
      expect(shouldAggregateLog('[AUTH] Login successful')).toBe(false);
    });
  });

  describe('aggregatedConsole', () => {
    it('should call logAggregator.log for log messages', () => {
      aggregatedConsole.log('test message');
      expect(logAggregator.log).toHaveBeenCalledWith('test message');
    });

    it('should call logAggregator.warn for warn messages', () => {
      aggregatedConsole.warn('warning message');
      expect(logAggregator.warn).toHaveBeenCalledWith('warning message');
    });

    it('should call logAggregator.error for error messages', () => {
      aggregatedConsole.error('error message');
      expect(logAggregator.error).toHaveBeenCalledWith('error message');
    });

    it('should call logAggregator.log for info messages', () => {
      aggregatedConsole.info('info message');
      expect(logAggregator.log).toHaveBeenCalledWith('info message');
    });

    it('should concatenate additional arguments', () => {
      aggregatedConsole.log('message', 'arg1', 'arg2');
      expect(logAggregator.log).toHaveBeenCalledWith('message arg1 arg2');
    });
  });

  describe('SmartConsole', () => {
    it('should aggregate spammy DID_RESOLVER log messages', () => {
      smartConsole.log('[DID_RESOLVER] Timeout during resolution');
      expect(logAggregator.log).toHaveBeenCalledWith(
        '[DID_RESOLVER] Timeout during resolution'
      );
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should not aggregate regular log messages', () => {
      smartConsole.log('Regular message');
      expect(console.log).toHaveBeenCalledWith('Regular message');
      expect(logAggregator.log).not.toHaveBeenCalled();
    });

    it('should aggregate spammy warn messages', () => {
      smartConsole.warn('[DID_RESOLVER] Network error');
      expect(logAggregator.warn).toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should not aggregate regular warn messages', () => {
      smartConsole.warn('Regular warning');
      expect(console.warn).toHaveBeenCalledWith('Regular warning');
      expect(logAggregator.warn).not.toHaveBeenCalled();
    });

    it('should aggregate spammy error messages', () => {
      smartConsole.error('[DID_RESOLVER] Circuit breaker open');
      expect(logAggregator.error).toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should not aggregate regular error messages', () => {
      smartConsole.error('Regular error');
      expect(console.error).toHaveBeenCalledWith('Regular error');
      expect(logAggregator.error).not.toHaveBeenCalled();
    });

    it('should aggregate spammy info messages', () => {
      smartConsole.info('[DID_RESOLVER] Attempt 1 failed');
      expect(logAggregator.log).toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should not aggregate regular info messages', () => {
      smartConsole.info('Regular info');
      expect(console.log).toHaveBeenCalledWith('Regular info');
      expect(logAggregator.log).not.toHaveBeenCalled();
    });

    it('should concatenate additional arguments', () => {
      smartConsole.log('Regular', 'arg1', 'arg2');
      expect(console.log).toHaveBeenCalledWith('Regular arg1 arg2');
    });
  });
});
