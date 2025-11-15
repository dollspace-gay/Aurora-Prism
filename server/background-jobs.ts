/**
 * Background Jobs
 * Scheduled tasks for maintenance and cleanup operations
 */

import { storage } from './storage';
import { logAllPoolStatus } from './pool-metrics';

/**
 * Clean up expired sessions
 * Only deletes sessions that expired 90+ days ago
 * This preserves recently logged-in users for data pruning protection
 * Runs every hour
 */
async function cleanupExpiredSessions(): Promise<void> {
  try {
    console.log('[BackgroundJobs] Starting expired session cleanup (90+ days old)...');
    await storage.deleteExpiredSessions();
    console.log('[BackgroundJobs] Expired session cleanup completed');
  } catch (error) {
    console.error('[BackgroundJobs] Error cleaning up expired sessions:', error);
  }
}

/**
 * Clean up expired OAuth states
 * Runs every hour
 */
async function cleanupExpiredOAuthStates(): Promise<void> {
  try {
    console.log('[BackgroundJobs] Starting expired OAuth state cleanup...');
    // OAuth states older than 24 hours can be safely deleted
    // The deleteOAuthState function should be enhanced to support batch deletion
    // For now, this is a placeholder
    console.log('[BackgroundJobs] OAuth state cleanup completed');
  } catch (error) {
    console.error('[BackgroundJobs] Error cleaning up OAuth states:', error);
  }
}

/**
 * Log pool status
 * Runs every 60 seconds
 */
function logPoolStatus(): void {
  try {
    logAllPoolStatus();
  } catch (error) {
    console.error('[BackgroundJobs] Error logging pool status:', error);
  }
}

/**
 * Start all background jobs
 */
export function startBackgroundJobs(): void {
  if (process.env.NODE_ENV === 'test') {
    console.log('[BackgroundJobs] Skipping background jobs in test environment');
    return;
  }

  console.log('[BackgroundJobs] Starting background jobs...');

  // Clean up expired sessions every hour
  const sessionCleanupInterval = setInterval(
    cleanupExpiredSessions,
    60 * 60 * 1000
  );

  // Clean up expired OAuth states every 6 hours
  const oauthCleanupInterval = setInterval(
    cleanupExpiredOAuthStates,
    6 * 60 * 60 * 1000
  );

  // Log pool status every 60 seconds
  const poolStatusInterval = setInterval(logPoolStatus, 60 * 1000);

  // Run initial cleanup after 30 seconds (give server time to start)
  setTimeout(async () => {
    await cleanupExpiredSessions();
    await cleanupExpiredOAuthStates();
  }, 30000);

  // Log initial pool status after 5 seconds
  setTimeout(logPoolStatus, 5000);

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[BackgroundJobs] Stopping background jobs...');
    clearInterval(sessionCleanupInterval);
    clearInterval(oauthCleanupInterval);
    clearInterval(poolStatusInterval);
  });

  console.log('[BackgroundJobs] Background jobs started successfully');
}
