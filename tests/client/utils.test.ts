import { describe, it, expect } from 'vitest';
import { cn } from '../../client/src/lib/utils';

describe('cn (className utility)', () => {
  describe('basic functionality', () => {
    it('should return empty string for no arguments', () => {
      expect(cn()).toBe('');
    });

    it('should return single class unchanged', () => {
      expect(cn('foo')).toBe('foo');
    });

    it('should merge multiple classes', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('should handle undefined and null values', () => {
      expect(cn('foo', undefined, 'bar', null)).toBe('foo bar');
    });

    it('should handle boolean false', () => {
      expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
    });

    it('should handle boolean true conditions', () => {
      expect(cn('foo', true && 'bar', 'baz')).toBe('foo bar baz');
    });
  });

  describe('clsx object syntax', () => {
    it('should handle object with true values', () => {
      expect(cn({ foo: true, bar: true })).toBe('foo bar');
    });

    it('should handle object with false values', () => {
      expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
    });

    it('should handle mixed strings and objects', () => {
      expect(cn('base', { active: true, disabled: false })).toBe('base active');
    });
  });

  describe('clsx array syntax', () => {
    it('should handle arrays', () => {
      expect(cn(['foo', 'bar'])).toBe('foo bar');
    });

    it('should handle nested arrays', () => {
      expect(cn(['foo', ['bar', 'baz']])).toBe('foo bar baz');
    });

    it('should handle arrays with falsy values', () => {
      expect(cn(['foo', null, undefined, 'bar'])).toBe('foo bar');
    });
  });

  describe('tailwind-merge functionality', () => {
    it('should merge conflicting tailwind classes (keep last)', () => {
      // tailwind-merge should resolve conflicts
      expect(cn('p-2', 'p-4')).toBe('p-4');
    });

    it('should merge conflicting text colors', () => {
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    });

    it('should merge conflicting backgrounds', () => {
      expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
    });

    it('should not merge non-conflicting classes', () => {
      expect(cn('p-4', 'm-4')).toBe('p-4 m-4');
    });

    it('should merge padding variants correctly', () => {
      expect(cn('px-2', 'py-4', 'px-4')).toBe('py-4 px-4');
    });

    it('should handle hover states separately', () => {
      expect(cn('hover:bg-red-500', 'hover:bg-blue-500')).toBe('hover:bg-blue-500');
    });

    it('should handle responsive prefixes', () => {
      expect(cn('md:p-2', 'md:p-4')).toBe('md:p-4');
    });

    it('should not merge different responsive prefixes', () => {
      expect(cn('md:p-2', 'lg:p-4')).toBe('md:p-2 lg:p-4');
    });
  });

  describe('complex combinations', () => {
    it('should handle typical component class patterns', () => {
      const baseClasses = 'flex items-center justify-center';
      const sizeClasses = 'h-10 w-10';
      const conditionalClasses = { 'bg-blue-500': true, 'opacity-50': false };

      expect(cn(baseClasses, sizeClasses, conditionalClasses)).toBe(
        'flex items-center justify-center h-10 w-10 bg-blue-500'
      );
    });

    it('should handle variant overrides', () => {
      const base = 'rounded-md bg-gray-100 text-gray-900';
      const variant = 'bg-blue-500 text-white';

      expect(cn(base, variant)).toBe('rounded-md bg-blue-500 text-white');
    });

    it('should handle button-like class composition', () => {
      const base = 'inline-flex items-center justify-center rounded-md text-sm font-medium';
      const size = 'h-10 px-4 py-2';
      const variant = 'bg-primary text-primary-foreground hover:bg-primary/90';
      const disabled = false;
      const className = 'custom-class';

      const result = cn(base, size, variant, disabled && 'opacity-50', className);

      expect(result).toContain('inline-flex');
      expect(result).toContain('h-10');
      expect(result).toContain('bg-primary');
      expect(result).toContain('custom-class');
      expect(result).not.toContain('opacity-50');
    });

    it('should handle deeply nested conditional logic', () => {
      const isActive = true;
      const isDisabled = false;
      const size = 'lg';

      const result = cn(
        'base',
        isActive && 'active',
        isDisabled && 'disabled',
        {
          'size-sm': size === 'sm',
          'size-md': size === 'md',
          'size-lg': size === 'lg',
        }
      );

      expect(result).toBe('base active size-lg');
    });
  });
});
