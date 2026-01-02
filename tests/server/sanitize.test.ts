import { describe, it, expect } from 'vitest';
import {
  sanitizeString,
  removeNullBytesFromObject,
  sanitizeObject,
} from '../../server/utils/sanitize';

describe('sanitizeString', () => {
  it('should return null for null input', () => {
    expect(sanitizeString(null)).toBeNull();
  });

  it('should return undefined for undefined input', () => {
    expect(sanitizeString(undefined)).toBeUndefined();
  });

  it('should return empty string unchanged', () => {
    expect(sanitizeString('')).toBe('');
  });

  it('should return string without null bytes unchanged', () => {
    expect(sanitizeString('Hello World')).toBe('Hello World');
  });

  it('should remove single null byte', () => {
    expect(sanitizeString('Hello\u0000World')).toBe('HelloWorld');
  });

  it('should remove multiple null bytes', () => {
    expect(sanitizeString('\u0000Hello\u0000World\u0000')).toBe('HelloWorld');
  });

  it('should handle string with only null bytes', () => {
    expect(sanitizeString('\u0000\u0000\u0000')).toBe('');
  });

  it('should preserve other unicode characters', () => {
    expect(sanitizeString('Hello 世界 🌍')).toBe('Hello 世界 🌍');
  });

  it('should preserve other control characters', () => {
    expect(sanitizeString('Line1\nLine2\tTab')).toBe('Line1\nLine2\tTab');
  });
});

describe('removeNullBytesFromObject', () => {
  it('should return null for null input', () => {
    expect(removeNullBytesFromObject(null)).toBeNull();
  });

  it('should return undefined for undefined input', () => {
    expect(removeNullBytesFromObject(undefined)).toBeUndefined();
  });

  it('should handle primitive string', () => {
    expect(removeNullBytesFromObject('Hello\u0000World')).toBe('HelloWorld');
  });

  it('should handle primitive number', () => {
    expect(removeNullBytesFromObject(42)).toBe(42);
  });

  it('should handle primitive boolean', () => {
    expect(removeNullBytesFromObject(true)).toBe(true);
  });

  it('should preserve Date objects', () => {
    const date = new Date('2024-01-01');
    expect(removeNullBytesFromObject(date)).toBe(date);
  });

  it('should preserve RegExp objects', () => {
    const regex = /test/gi;
    expect(removeNullBytesFromObject(regex)).toBe(regex);
  });

  it('should preserve Error objects', () => {
    const error = new Error('test');
    expect(removeNullBytesFromObject(error)).toBe(error);
  });

  it('should sanitize strings in arrays', () => {
    const input = ['Hello\u0000', 'World\u0000'];
    const output = removeNullBytesFromObject(input);
    expect(output).toEqual(['Hello', 'World']);
  });

  it('should handle nested arrays', () => {
    const input = [['Hello\u0000'], ['World\u0000']];
    const output = removeNullBytesFromObject(input);
    expect(output).toEqual([['Hello'], ['World']]);
  });

  it('should sanitize strings in objects', () => {
    const input = { name: 'Test\u0000', value: 'Data\u0000' };
    const output = removeNullBytesFromObject(input);
    expect(output).toEqual({ name: 'Test', value: 'Data' });
  });

  it('should handle nested objects', () => {
    const input = {
      outer: {
        inner: 'Value\u0000',
        nested: {
          deep: 'Deep\u0000Value',
        },
      },
    };
    const output = removeNullBytesFromObject(input);
    expect(output).toEqual({
      outer: {
        inner: 'Value',
        nested: {
          deep: 'DeepValue',
        },
      },
    });
  });

  it('should handle mixed arrays and objects', () => {
    const input = {
      items: [
        { name: 'Item1\u0000' },
        { name: 'Item2\u0000' },
      ],
      tags: ['tag1\u0000', 'tag2\u0000'],
    };
    const output = removeNullBytesFromObject(input);
    expect(output).toEqual({
      items: [
        { name: 'Item1' },
        { name: 'Item2' },
      ],
      tags: ['tag1', 'tag2'],
    });
  });

  it('should preserve non-string values in objects', () => {
    const input = {
      str: 'Hello\u0000',
      num: 42,
      bool: true,
      nil: null,
    };
    const output = removeNullBytesFromObject(input);
    expect(output).toEqual({
      str: 'Hello',
      num: 42,
      bool: true,
      nil: null,
    });
  });

  it('should handle empty objects', () => {
    expect(removeNullBytesFromObject({})).toEqual({});
  });

  it('should handle empty arrays', () => {
    expect(removeNullBytesFromObject([])).toEqual([]);
  });
});

describe('sanitizeObject (deprecated)', () => {
  it('should be an alias for removeNullBytesFromObject', () => {
    const input = { name: 'Test\u0000' };
    expect(sanitizeObject(input)).toEqual(removeNullBytesFromObject(input));
  });
});
