/**
 * Bounded Map with LRU Eviction
 * Prevents unbounded memory growth by enforcing maximum size with LRU eviction policy
 */

export class BoundedMap<K, V> extends Map<K, V> {
  private maxSize: number;
  private accessOrder: K[] = []; // Track access order for LRU

  constructor(maxSize: number, entries?: readonly (readonly [K, V])[] | null) {
    super(entries);
    if (maxSize <= 0) {
      throw new Error('BoundedMap maxSize must be positive');
    }
    this.maxSize = maxSize;
    if (entries) {
      this.accessOrder = Array.from(entries).map(([key]) => key);
      this.enforceLimit();
    }
  }

  set(key: K, value: V): this {
    // If key exists, remove from access order (will be added at end)
    if (this.has(key)) {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    }

    // Add/update entry
    super.set(key, value);

    // Add to end of access order (most recent)
    this.accessOrder.push(key);

    // Enforce size limit
    this.enforceLimit();

    return this;
  }

  get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      // Move to end of access order (most recently accessed)
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
        this.accessOrder.push(key);
      }
    }
    return value;
  }

  delete(key: K): boolean {
    const deleted = super.delete(key);
    if (deleted) {
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    }
    return deleted;
  }

  clear(): void {
    super.clear();
    this.accessOrder = [];
  }

  /**
   * Enforce size limit by evicting least recently used entries
   */
  private enforceLimit(): void {
    while (this.size > this.maxSize) {
      // Evict least recently used (first in access order)
      const oldestKey = this.accessOrder.shift();
      if (oldestKey !== undefined) {
        super.delete(oldestKey);
      }
    }
  }

  /**
   * Get current max size
   */
  getMaxSize(): number {
    return this.maxSize;
  }

  /**
   * Update max size (will trigger eviction if current size exceeds new limit)
   */
  setMaxSize(newMaxSize: number): void {
    if (newMaxSize <= 0) {
      throw new Error('BoundedMap maxSize must be positive');
    }
    this.maxSize = newMaxSize;
    this.enforceLimit();
  }

  /**
   * Get utilization percentage
   */
  getUtilization(): number {
    return (this.size / this.maxSize) * 100;
  }

  /**
   * Check if map is near capacity
   */
  isNearCapacity(threshold: number = 0.9): boolean {
    return this.size >= this.maxSize * threshold;
  }
}

/**
 * Bounded Map for arrays of values with LRU eviction
 * Special case for maps that store arrays as values
 */
export class BoundedArrayMap<K, V> extends BoundedMap<K, V[]> {
  private maxArrays: number;
  private maxItemsPerArray: number;

  constructor(
    maxArrays: number,
    maxItemsPerArray: number = 1000,
    entries?: readonly (readonly [K, V[]])[] | null
  ) {
    super(maxArrays, entries);
    this.maxArrays = maxArrays;
    this.maxItemsPerArray = maxItemsPerArray;
  }

  /**
   * Add item to array for given key
   */
  add(key: K, item: V): void {
    const existing = this.get(key) || [];

    // Enforce per-array item limit
    if (existing.length >= this.maxItemsPerArray) {
      console.warn(
        `[BoundedArrayMap] Array for key ${String(key)} reached max items (${this.maxItemsPerArray}), dropping oldest item`
      );
      existing.shift(); // Remove oldest item
    }

    existing.push(item);
    this.set(key, existing);
  }

  /**
   * Remove specific item from array
   */
  remove(key: K, predicate: (item: V) => boolean): boolean {
    const existing = this.get(key);
    if (!existing) return false;

    const initialLength = existing.length;
    const filtered = existing.filter((item) => !predicate(item));

    if (filtered.length === 0) {
      this.delete(key);
    } else if (filtered.length < initialLength) {
      this.set(key, filtered);
    }

    return filtered.length < initialLength;
  }

  /**
   * Get total count of items across all arrays
   */
  getTotalItemCount(): number {
    let count = 0;
    for (const array of this.values()) {
      count += array.length;
    }
    return count;
  }

  /**
   * Get statistics about the map
   */
  getStats(): {
    arrayCount: number;
    totalItems: number;
    avgItemsPerArray: number;
    maxItems: number;
    utilization: number;
  } {
    const arrays = Array.from(this.values());
    const totalItems = arrays.reduce((sum, arr) => sum + arr.length, 0);

    return {
      arrayCount: this.size,
      totalItems,
      avgItemsPerArray: arrays.length > 0 ? totalItems / arrays.length : 0,
      maxItems: arrays.length > 0 ? Math.max(...arrays.map((a) => a.length)) : 0,
      utilization: this.getUtilization(),
    };
  }
}
