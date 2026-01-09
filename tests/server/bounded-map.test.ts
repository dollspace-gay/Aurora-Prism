import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoundedMap, BoundedArrayMap } from '../../server/bounded-map';

describe('BoundedMap', () => {
  describe('constructor', () => {
    it('should create map with positive maxSize', () => {
      const map = new BoundedMap(10);
      expect(map.getMaxSize()).toBe(10);
      expect(map.size).toBe(0);
    });

    it('should throw for zero maxSize', () => {
      expect(() => new BoundedMap(0)).toThrow(
        'BoundedMap maxSize must be positive'
      );
    });

    it('should throw for negative maxSize', () => {
      expect(() => new BoundedMap(-5)).toThrow(
        'BoundedMap maxSize must be positive'
      );
    });
  });

  describe('set and get', () => {
    it('should store and retrieve values', () => {
      const map = new BoundedMap(10);
      map.set('key', 42);
      expect(map.get('key')).toBe(42);
    });

    it('should update existing values', () => {
      const map = new BoundedMap(10);
      map.set('key', 1);
      map.set('key', 2);
      expect(map.get('key')).toBe(2);
      expect(map.size).toBe(1);
    });

    it('should return undefined for non-existent keys', () => {
      const map = new BoundedMap(10);
      expect(map.get('nonexistent')).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when exceeding maxSize', () => {
      const map = new BoundedMap(3);
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      map.set('d', 4);

      expect(map.size).toBe(3);
      expect(map.has('a')).toBe(false);
      expect(map.get('b')).toBe(2);
      expect(map.get('c')).toBe(3);
      expect(map.get('d')).toBe(4);
    });

    it('should update access order on get', () => {
      const map = new BoundedMap(3);
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);

      map.get('a');
      map.set('d', 4);

      expect(map.has('a')).toBe(true);
      expect(map.has('b')).toBe(false);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete existing entries', () => {
      const map = new BoundedMap(10);
      map.set('key', 42);
      expect(map.delete('key')).toBe(true);
      expect(map.has('key')).toBe(false);
    });

    it('should return false for non-existent keys', () => {
      const map = new BoundedMap(10);
      expect(map.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const map = new BoundedMap(10);
      map.set('a', 1);
      map.set('b', 2);
      map.clear();
      expect(map.size).toBe(0);
    });
  });

  describe('setMaxSize', () => {
    it('should update maxSize', () => {
      const map = new BoundedMap(10);
      map.setMaxSize(20);
      expect(map.getMaxSize()).toBe(20);
    });

    it('should throw for non-positive maxSize', () => {
      const map = new BoundedMap(10);
      expect(() => map.setMaxSize(0)).toThrow(
        'BoundedMap maxSize must be positive'
      );
    });

    it('should evict entries when reducing maxSize', () => {
      const map = new BoundedMap(5);
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      map.set('d', 4);
      map.set('e', 5);

      map.setMaxSize(3);

      expect(map.size).toBe(3);
      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(false);
      expect(map.has('c')).toBe(true);
    });
  });

  describe('getUtilization', () => {
    it('should return correct utilization percentage', () => {
      const map = new BoundedMap(10);
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      expect(map.getUtilization()).toBe(30);
    });
  });

  describe('isNearCapacity', () => {
    it('should return true when at or above threshold', () => {
      const map = new BoundedMap(10);
      for (let i = 0; i < 9; i++) {
        map.set(String(i), i);
      }
      expect(map.isNearCapacity(0.9)).toBe(true);
    });
  });
});

describe('BoundedArrayMap', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('add', () => {
    it('should add items to array', () => {
      const map = new BoundedArrayMap(10);
      map.add('key', 1);
      map.add('key', 2);
      map.add('key', 3);
      expect(map.get('key')).toEqual([1, 2, 3]);
    });

    it('should enforce maxItemsPerArray limit', () => {
      const map = new BoundedArrayMap(10, 3);
      map.add('key', 1);
      map.add('key', 2);
      map.add('key', 3);
      map.add('key', 4);
      expect(map.get('key')).toEqual([2, 3, 4]);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should remove items matching predicate', () => {
      const map = new BoundedArrayMap(10);
      map.add('key', 1);
      map.add('key', 2);
      map.add('key', 3);

      const removed = map.remove('key', (item) => item === 2);
      expect(removed).toBe(true);
      expect(map.get('key')).toEqual([1, 3]);
    });

    it('should return false for non-existent key', () => {
      const map = new BoundedArrayMap(10);
      const removed = map.remove('nonexistent', () => true);
      expect(removed).toBe(false);
    });
  });

  describe('getTotalItemCount', () => {
    it('should return total count of items across all arrays', () => {
      const map = new BoundedArrayMap(10);
      map.add('a', 1);
      map.add('a', 2);
      map.add('b', 3);
      expect(map.getTotalItemCount()).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const map = new BoundedArrayMap(10);
      map.add('a', 1);
      map.add('a', 2);
      map.add('b', 3);

      const stats = map.getStats();
      expect(stats.arrayCount).toBe(2);
      expect(stats.totalItems).toBe(3);
    });
  });
});
