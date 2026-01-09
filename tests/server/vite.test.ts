import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from '../../server/vite';

describe('vite server utilities', () => {
  describe('log function', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should log message with timestamp and source', () => {
      log('Test message');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(
          /\d{1,2}:\d{2}:\d{2}\s[AP]M\s\[express\]\sTest message/
        )
      );
    });

    it('should use custom source when provided', () => {
      log('Custom message', 'custom-source');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[custom-source]')
      );
    });

    it('should default to express as source', () => {
      log('Default source test');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[express]')
      );
    });

    it('should format time in 12-hour format', () => {
      log('Time format test');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\d{1,2}:\d{2}:\d{2}\s[AP]M/)
      );
    });

    it('should include the message content', () => {
      log('Specific message content');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Specific message content')
      );
    });
  });
});
