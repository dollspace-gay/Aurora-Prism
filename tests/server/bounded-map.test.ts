import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BoundedMap, BoundedArrayMap } from '../../server/bounded-map';

describe('BoundedMap', () => {
  describe('constructor', () => {
    it('should create empty map with specified maxSize', () => {
      const map = new BoundedMap<string, number>(10);
      expect(map.size).toBe(0);
      expect(map.getMaxSize()).toBe(10);
    });

    it('should throw error if maxSize is zero', () => {
      expect(() => new BoundedMap<string, number>(0)).toThrow(
        'BoundedMap maxSize must be positive'
      );
    });

    it('should throw error if maxSize is negative', () => {
      expect(() => new BoundedMap<string, number>(-1)).toThrow(
        'BoundedMap maxSize must be positive'
      );
    });

    it('should initialize with entries', () => {
      const entries: [string, number][] = [
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ];
      const map = new BoundedMap<string, number>(10, entries);
      expect(map.size).toBe(3);
      expect(map.get('a')).toBe(1);
      expect(map.get('b')).toBe(2);
      expect(map.get('c')).toBe(3);
    });

    it('should enforce limit when initialized with too many entries', () => {
      const entries: [string, number][] = [
        ['a', 1],
        ['b', 2],
        ['c', 3],
        ['d', 4],
        ['e', 5],
      ];
      const map = new BoundedMap<string, number>(3, entries);
      expect(map.size).toBe(3);
      // First two should be evicted (LRU)
      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(false);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
      expect(map.has('e')).toBe(true);
    });
  });

  describe('set', () => {
    let map: BoundedMap<string, number>;

    beforeEach(() => {
      map = new BoundedMap<string, number>(3);
    });

    it('should add new entries', () => {
      map.set('a', 1);
      expect(map.get('a')).toBe(1);
      expect(map.size).toBe(1);
    });

    it('should update existing entries', () => {
      map.set('a', 1);
      map.set('a', 2);
      expect(map.get('a')).toBe(2);
      expect(map.size).toBe(1);
    });

    it('should evict oldest entry when exceeding maxSize', () => {
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      map.set('d', 4); // Should evict 'a'

      expect(map.size).toBe(3);
      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(true);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });

    it('should return this for chaining', () => {
      const result = map.set('a', 1);
      expect(result).toBe(map);
    });

    it('should update access order when setting existing key', () => {
      map.set('a', 1);
      map.set('b', 2);
      map.set('a', 10); // Updates 'a', moves it to end
      map.set('c', 3);
      map.set('d', 4); // Should evict 'b' (now oldest)

      expect(map.has('a')).toBe(true);
      expect(map.has('b')).toBe(false);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });
  });

  describe('get', () => {
    let map: BoundedMap<string, number>;

    beforeEach(() => {
      map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);
    });

    it('should return value for existing key', () => {
      expect(map.get('a')).toBe(1);
    });

    it('should return undefined for non-existent key', () => {
      expect(map.get('z')).toBeUndefined();
    });

    it('should update access order on get', () => {
      map.get('a'); // Access 'a', moves it to end
      map.set('c', 3);
      map.set('d', 4); // Should evict 'b' (now oldest)

      expect(map.has('a')).toBe(true);
      expect(map.has('b')).toBe(false);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });
  });

  describe('delete', () => {
    let map: BoundedMap<string, number>;

    beforeEach(() => {
      map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);
    });

    it('should delete existing entry', () => {
      const result = map.delete('a');
      expect(result).toBe(true);
      expect(map.has('a')).toBe(false);
      expect(map.size).toBe(1);
    });

    it('should return false for non-existent key', () => {
      const result = map.delete('z');
      expect(result).toBe(false);
      expect(map.size).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);
      map.clear();

      expect(map.size).toBe(0);
      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(false);
    });
  });

  describe('setMaxSize', () => {
    it('should update max size', () => {
      const map = new BoundedMap<string, number>(5);
      map.setMaxSize(10);
      expect(map.getMaxSize()).toBe(10);
    });

    it('should throw error for non-positive max size', () => {
      const map = new BoundedMap<string, number>(5);
      expect(() => map.setMaxSize(0)).toThrow(
        'BoundedMap maxSize must be positive'
      );
      expect(() => map.setMaxSize(-1)).toThrow(
        'BoundedMap maxSize must be positive'
      );
    });

    it('should evict entries when reducing max size', () => {
      const map = new BoundedMap<string, number>(5);
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      map.set('d', 4);
      map.set('e', 5);

      map.setMaxSize(2);

      expect(map.size).toBe(2);
      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(false);
      expect(map.has('c')).toBe(false);
      expect(map.has('d')).toBe(true);
      expect(map.has('e')).toBe(true);
    });
  });

  describe('getUtilization', () => {
    it('should return 0 for empty map', () => {
      const map = new BoundedMap<string, number>(10);
      expect(map.getUtilization()).toBe(0);
    });

    it('should return correct percentage', () => {
      const map = new BoundedMap<string, number>(10);
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      expect(map.getUtilization()).toBe(30);
    });

    it('should return 100 when at capacity', () => {
      const map = new BoundedMap<string, number>(3);
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      expect(map.getUtilization()).toBe(100);
    });
  });

  describe('isNearCapacity', () => {
    let map: BoundedMap<string, number>;

    beforeEach(() => {
      map = new BoundedMap<string, number>(10);
    });

    it('should return false when below threshold', () => {
      map.set('a', 1);
      map.set('b', 2);
      expect(map.isNearCapacity(0.9)).toBe(false);
    });

    it('should return true when at or above threshold', () => {
      for (let i = 0; i < 9; i++) {
        map.set(`key${i}`, i);
      }
      expect(map.isNearCapacity(0.9)).toBe(true);
    });

    it('should use default threshold of 0.9', () => {
      for (let i = 0; i < 8; i++) {
        map.set(`key${i}`, i);
      }
      expect(map.isNearCapacity()).toBe(false);

      map.set('key8', 8);
      expect(map.isNearCapacity()).toBe(true);
    });
  });
});

describe('BoundedArrayMap', () => {
  describe('constructor', () => {
    it('should create empty map with specified limits', () => {
      const map = new BoundedArrayMap<string, number>(10, 100);
      expect(map.size).toBe(0);
      expect(map.getMaxSize()).toBe(10);
    });

    it('should initialize with entries', () => {
      const entries: [string, number[]][] = [
        ['a', [1, 2, 3]],
        ['b', [4, 5]],
      ];
      const map = new BoundedArrayMap<string, number>(10, 100, entries);
      expect(map.size).toBe(2);
      expect(map.get('a')).toEqual([1, 2, 3]);
      expect(map.get('b')).toEqual([4, 5]);
    });
  });

  describe('add', () => {
    let map: BoundedArrayMap<string, number>;

    beforeEach(() => {
      map = new BoundedArrayMap<string, number>(3, 5);
    });

    it('should add item to new array', () => {
      map.add('a', 1);
      expect(map.get('a')).toEqual([1]);
    });

    it('should append item to existing array', () => {
      map.add('a', 1);
      map.add('a', 2);
      map.add('a', 3);
      expect(map.get('a')).toEqual([1, 2, 3]);
    });

    it('should drop oldest item when array exceeds maxItemsPerArray', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      map.add('a', 1);
      map.add('a', 2);
      map.add('a', 3);
      map.add('a', 4);
      map.add('a', 5);
      map.add('a', 6); // Should drop 1

      expect(map.get('a')).toEqual([2, 3, 4, 5, 6]);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should evict oldest array when exceeding maxArrays', () => {
      map.add('a', 1);
      map.add('b', 2);
      map.add('c', 3);
      map.add('d', 4); // Should evict 'a'

      expect(map.has('a')).toBe(false);
      expect(map.has('b')).toBe(true);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });
  });

  describe('remove', () => {
    let map: BoundedArrayMap<string, number>;

    beforeEach(() => {
      map = new BoundedArrayMap<string, number>(10, 100);
      map.add('a', 1);
      map.add('a', 2);
      map.add('a', 3);
    });

    it('should remove matching items', () => {
      const result = map.remove('a', (item) => item === 2);
      expect(result).toBe(true);
      expect(map.get('a')).toEqual([1, 3]);
    });

    it('should return false if no items match', () => {
      const result = map.remove('a', (item) => item === 99);
      expect(result).toBe(false);
      expect(map.get('a')).toEqual([1, 2, 3]);
    });

    it('should return false for non-existent key', () => {
      const result = map.remove('z', (item) => item === 1);
      expect(result).toBe(false);
    });

    it('should delete key if array becomes empty', () => {
      map.remove('a', (item) => item === 1);
      map.remove('a', (item) => item === 2);
      map.remove('a', (item) => item === 3);

      expect(map.has('a')).toBe(false);
    });
  });

  describe('getTotalItemCount', () => {
    it('should return 0 for empty map', () => {
      const map = new BoundedArrayMap<string, number>(10, 100);
      expect(map.getTotalItemCount()).toBe(0);
    });

    it('should return total count across all arrays', () => {
      const map = new BoundedArrayMap<string, number>(10, 100);
      map.add('a', 1);
      map.add('a', 2);
      map.add('b', 3);
      map.add('b', 4);
      map.add('b', 5);
      map.add('c', 6);

      expect(map.getTotalItemCount()).toBe(6);
    });
  });

  describe('getStats', () => {
    it('should return correct stats for empty map', () => {
      const map = new BoundedArrayMap<string, number>(10, 100);
      const stats = map.getStats();

      expect(stats.arrayCount).toBe(0);
      expect(stats.totalItems).toBe(0);
      expect(stats.avgItemsPerArray).toBe(0);
      expect(stats.maxItems).toBe(0);
      expect(stats.utilization).toBe(0);
    });

    it('should return correct stats for populated map', () => {
      const map = new BoundedArrayMap<string, number>(10, 100);
      map.add('a', 1);
      map.add('a', 2);
      map.add('a', 3);
      map.add('b', 4);
      map.add('c', 5);
      map.add('c', 6);

      const stats = map.getStats();

      expect(stats.arrayCount).toBe(3);
      expect(stats.totalItems).toBe(6);
      expect(stats.avgItemsPerArray).toBe(2);
      expect(stats.maxItems).toBe(3);
      expect(stats.utilization).toBe(30);
    });
  });
});
