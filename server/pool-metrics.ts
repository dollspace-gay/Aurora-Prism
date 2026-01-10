/**
 * Connection Pool Metrics Monitoring
 * Tracks connection pool usage and health metrics
 */

import type { Pool as NeonPool } from '@neondatabase/serverless';
import type { Pool as PgPool } from 'pg';

export interface PoolMetrics {
  total: number; // Total pool size
  active: number; // Active connections
  idle: number; // Idle connections
  waiting: number; // Queries waiting for connection
  timestamp: number;
}

export class PoolMonitor {
  private metrics: PoolMetrics[] = [];
  private readonly maxHistory = 100; // Keep last 100 samples
  private warningThreshold = 0.8; // Warn if pool is 80% utilized
  private criticalThreshold = 0.95; // Critical if 95% utilized

  constructor(
    private pool: NeonPool | PgPool,
    private label: string = 'default'
  ) {}

  /**
   * Collect current pool metrics
   */
  collect(): PoolMetrics {
    // Access internal pool properties for metrics (not part of public API)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pool = this.pool as any;

    const metrics: PoolMetrics = {
      total: pool.options?.max || pool._maxSize || 0,
      active: pool._clients?.length - pool._idle?.length || 0,
      idle: pool._idle?.length || pool.idleCount || 0,
      waiting: pool._pendingQueue?.length || pool.waitingCount || 0,
      timestamp: Date.now(),
    };

    // Store metrics
    this.metrics.push(metrics);
    if (this.metrics.length > this.maxHistory) {
      this.metrics.shift();
    }

    // Check thresholds
    this.checkThresholds(metrics);

    return metrics;
  }

  /**
   * Check if pool usage exceeds thresholds
   */
  private checkThresholds(metrics: PoolMetrics): void {
    const utilization = metrics.active / metrics.total;

    if (utilization >= this.criticalThreshold) {
      console.error(
        '[PoolMonitor:%s] CRITICAL: Pool %s% utilized (%d/%d), %d waiting',
        this.label,
        (utilization * 100).toFixed(1),
        metrics.active,
        metrics.total,
        metrics.waiting
      );
    } else if (utilization >= this.warningThreshold) {
      console.warn(
        '[PoolMonitor:%s] WARNING: Pool %s% utilized (%d/%d), %d waiting',
        this.label,
        (utilization * 100).toFixed(1),
        metrics.active,
        metrics.total,
        metrics.waiting
      );
    }

    // Warn about waiting queries
    if (metrics.waiting > 0) {
      console.warn(
        '[PoolMonitor:%s] %d queries waiting for connections',
        this.label,
        metrics.waiting
      );
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): PoolMetrics | null {
    return this.metrics[this.metrics.length - 1] || null;
  }

  /**
   * Get metrics history
   */
  getHistory(): PoolMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get average metrics over time window
   */
  getAverages(windowMs: number = 60000): {
    avgActive: number;
    avgIdle: number;
    avgWaiting: number;
    maxUtilization: number;
  } {
    const cutoff = Date.now() - windowMs;
    const recent = this.metrics.filter((m) => m.timestamp >= cutoff);

    if (recent.length === 0) {
      return { avgActive: 0, avgIdle: 0, avgWaiting: 0, maxUtilization: 0 };
    }

    const sum = recent.reduce(
      (acc, m) => ({
        active: acc.active + m.active,
        idle: acc.idle + m.idle,
        waiting: acc.waiting + m.waiting,
        maxUtil: Math.max(acc.maxUtil, m.active / m.total),
      }),
      { active: 0, idle: 0, waiting: 0, maxUtil: 0 }
    );

    return {
      avgActive: sum.active / recent.length,
      avgIdle: sum.idle / recent.length,
      avgWaiting: sum.waiting / recent.length,
      maxUtilization: sum.maxUtil,
    };
  }

  /**
   * Start periodic monitoring
   */
  startMonitoring(intervalMs: number = 30000): NodeJS.Timeout {
    console.log(
      '[PoolMonitor:%s] Starting monitoring (interval: %dms)',
      this.label,
      intervalMs
    );
    return setInterval(() => {
      this.collect();
    }, intervalMs);
  }

  /**
   * Log current status
   */
  logStatus(): void {
    const metrics = this.getMetrics();
    if (!metrics) {
      console.log('[PoolMonitor:%s] No metrics available yet', this.label);
      return;
    }

    const utilization = ((metrics.active / metrics.total) * 100).toFixed(1);
    console.log(
      '[PoolMonitor:%s] Pool: %d/%d active (%s%%), %d idle, %d waiting',
      this.label,
      metrics.active,
      metrics.total,
      utilization,
      metrics.idle,
      metrics.waiting
    );
  }
}

/**
 * Global pool monitors registry
 */
const monitors = new Map<string, PoolMonitor>();

/**
 * Register a pool for monitoring
 */
export function registerPool(
  pool: NeonPool | PgPool,
  label: string
): PoolMonitor {
  const monitor = new PoolMonitor(pool, label);
  monitors.set(label, monitor);
  return monitor;
}

/**
 * Get monitor for a pool
 */
export function getMonitor(label: string): PoolMonitor | undefined {
  return monitors.get(label);
}

/**
 * Get all monitors
 */
export function getAllMonitors(): Map<string, PoolMonitor> {
  return monitors;
}

/**
 * Log status of all pools
 */
export function logAllPoolStatus(): void {
  console.log('\n[PoolMonitor] === Connection Pool Status ===');
  for (const [_label, monitor] of monitors.entries()) {
    monitor.logStatus();
  }
  console.log('[PoolMonitor] ================================\n');
}
