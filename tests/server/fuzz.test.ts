import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  sanitizeString,
  removeNullBytesFromObject,
} from '../../server/utils/sanitize';

describe('Fuzz Tests - sanitizeString', () => {
  it('should never throw on any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeString(input);
        // Should return a string or the same falsy value
        return typeof result === 'string' || result === input;
      }),
      { numRuns: 1000 }
    );
  });

  it('should always remove null bytes from output', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeString(input);
        if (typeof result === 'string') {
          return !result.includes('\u0000');
        }
        return true;
      }),
      { numRuns: 1000 }
    );
  });

  it('should preserve string length minus null bytes', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeString(input);
        if (typeof result === 'string') {
          const nullByteCount = (input.match(/\u0000/g) || []).length;
          return result.length === input.length - nullByteCount;
        }
        return true;
      }),
      { numRuns: 1000 }
    );
  });

  it('should handle strings with embedded null bytes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.constant('\u0000'))),
        (parts) => {
          const input = parts.join('');
          const result = sanitizeString(input);
          return typeof result === 'string' && !result.includes('\u0000');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should handle unicode strings correctly', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (input) => {
        const result = sanitizeString(input);
        if (typeof result === 'string') {
          // All non-null characters should be preserved
          const expectedLength =
            input.length - (input.match(/\u0000/g) || []).length;
          return result.length === expectedLength;
        }
        return true;
      }),
      { numRuns: 500 }
    );
  });
});

describe('Fuzz Tests - removeNullBytesFromObject', () => {
  it('should never throw on any JSON-compatible input', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        // Should not throw
        removeNullBytesFromObject(input);
        return true;
      }),
      { numRuns: 1000 }
    );
  });

  it('should preserve object structure', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.string(),
          value: fc.integer(),
          active: fc.boolean(),
        }),
        (input) => {
          const result = removeNullBytesFromObject(input) as typeof input;
          return (
            typeof result.name === 'string' &&
            typeof result.value === 'number' &&
            typeof result.active === 'boolean'
          );
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should handle deeply nested objects', () => {
    const deepObjectArb = fc.letrec((tie) => ({
      tree: fc.oneof(
        { depthSize: 'small' },
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.array(tie('tree'), { maxLength: 3 }),
        fc.record({
          left: tie('tree'),
          right: tie('tree'),
        })
      ),
    })).tree;

    fc.assert(
      fc.property(deepObjectArb, (input) => {
        // Should not throw on deeply nested structures
        removeNullBytesFromObject(input);
        return true;
      }),
      { numRuns: 500 }
    );
  });

  it('should handle arrays of mixed types', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.record({ key: fc.string() })
          )
        ),
        (input) => {
          const result = removeNullBytesFromObject(input);
          return Array.isArray(result) && result.length === input.length;
        }
      ),
      { numRuns: 500 }
    );
  });

  it('should return same primitive types', () => {
    fc.assert(
      fc.property(fc.integer(), (input) => {
        return removeNullBytesFromObject(input) === input;
      }),
      { numRuns: 100 }
    );

    fc.assert(
      fc.property(fc.boolean(), (input) => {
        return removeNullBytesFromObject(input) === input;
      }),
      { numRuns: 100 }
    );
  });
});

describe('Fuzz Tests - Edge Cases', () => {
  it('should handle very long strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10000, maxLength: 100000 }),
        (input) => {
          const result = sanitizeString(input);
          return typeof result === 'string';
        }
      ),
      { numRuns: 10 }
    );
  });

  it('should handle strings with many null bytes', () => {
    fc.assert(
      fc.property(fc.nat({ max: 1000 }), (count) => {
        const input = '\u0000'.repeat(count);
        const result = sanitizeString(input);
        return result === '';
      }),
      { numRuns: 100 }
    );
  });

  it('should handle empty and whitespace strings', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ', '\t', '\n', '\r')).map((arr) => arr.join('')),
        (input) => {
          const result = sanitizeString(input);
          return typeof result === 'string';
        }
      ),
      { numRuns: 100 }
    );
  });
});
