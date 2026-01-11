import 'dotenv/config';
import express, { type Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { registerRoutes } from './routes';
import { setupVite, serveStatic, log } from './vite';
import { logCollector } from './services/log-collector';
import { cacheService } from './services/cache';
import { startBackgroundJobs } from './background-jobs';

const app = express();

// Disable X-Powered-By header to prevent information disclosure
app.disable('x-powered-by');

// Trust proxy for proper IP detection behind reverse proxies (Replit, Cloudflare, etc.)
app.set('trust proxy', 1);

// Use 'extended' query parser to handle array parameters from clients
app.set('query parser', 'extended');

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Cookie parser for CSRF tokens
app.use(cookieParser());

// A custom, safe JSON body parser that doesn't crash on malformed input
const safeJsonParser = (req: Request, res: Response, next: NextFunction) => {
  // We only care about requests that might have a JSON body
  if (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS' ||
    req.method === 'DELETE'
  ) {
    return next();
  }

  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return next();
  }

  const chunks: Buffer[] = [];
  let totalLength = 0;
  const limit = 10 * 1024 * 1024; // 10mb limit

  req.on('data', (chunk: Buffer) => {
    totalLength += chunk.length;
    if (totalLength > limit) {
      res.status(413).json({
        error: 'PayloadTooLarge',
        message: 'Request body exceeds 10mb limit',
      });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (req.destroyed) return;

    const bodyBuffer = Buffer.concat(chunks);

    // Replicate the 'verify' functionality to store the raw body
    (req as Request & { rawBody?: Buffer }).rawBody = bodyBuffer;

    if (bodyBuffer.length === 0) {
      req.body = {};
      return next();
    }

    try {
      const bodyString = bodyBuffer.toString('utf8');
      req.body = JSON.parse(bodyString);
      next();
    } catch (error) {
      console.error('[BODY_PARSER] Malformed JSON received:', error);
      res.status(400).json({
        error: 'BadRequest',
        message: 'Malformed JSON in request body',
      });
    }
  });

  req.on('error', (err) => {
    console.error('[BODY_PARSER] Request stream error:', err);
    next(err);
  });
};

app.use(safeJsonParser);
app.use(
  express.urlencoded({
    extended: false,
    limit: '10mb', // Same limit for URL-encoded data
  })
);

// CORS configuration - Following official ATProto AppView standards
// Uses cors package without credentials (no Access-Control-Allow-Credentials: true)
// ATProto uses bearer token auth (Authorization header), not cookies
// This matches how official Bluesky AppView (bsky package) handles CORS
app.use(
  cors({
    // Cache preflight requests for 24 hours (matches official appview)
    maxAge: 86400,
    // Allow all standard methods
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    // ATProto-specific headers
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'atproto-accept-labelers',
      'X-CSRF-Token',
      'x-bsky-topics',
    ],
    // Expose ATProto-specific response headers
    exposedHeaders: [
      'atproto-content-labelers',
      'atproto-repo-rev',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
    ],
  })
);

// Logging configuration
const MAX_LOG_LINE_LENGTH = 80;
const MAX_LOG_LINE_LENGTH_TRUNCATED = 79;

// Fields that are safe to log (non-sensitive)
const SAFE_LOG_FIELDS = new Set([
  'did',
  'handle',
  'error',
  'message',
  'success',
  'count',
  'cursor',
  'hasMore',
]);

// Paths that should never have response bodies logged (contain tokens)
const SENSITIVE_PATHS = [
  '/api/auth/',
  '/xrpc/com.atproto.server.createSession',
  '/xrpc/com.atproto.server.refreshSession',
  '/xrpc/com.atproto.server.getSession',
];

/**
 * Sanitize response body for logging - removes sensitive fields like tokens
 */
function sanitizeResponseForLogging(
  response: Record<string, unknown>,
  path: string
): string {
  // Never log bodies from sensitive auth endpoints
  if (SENSITIVE_PATHS.some((p) => path.startsWith(p))) {
    return '[auth response - not logged]';
  }

  // For other endpoints, only include safe fields
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    if (SAFE_LOG_FIELDS.has(key)) {
      sanitized[key] = value;
    }
  }

  // If no safe fields, just indicate response size
  if (Object.keys(sanitized).length === 0) {
    const size = JSON.stringify(response).length;
    return `[${size} bytes]`;
  }

  return JSON.stringify(sanitized);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (path.startsWith('/api') || path.startsWith('/xrpc')) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${sanitizeResponseForLogging(capturedJsonResponse, path)}`;
      }

      if (logLine.length > MAX_LOG_LINE_LENGTH) {
        logLine = logLine.slice(0, MAX_LOG_LINE_LENGTH_TRUNCATED) + '…';
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize search extensions before registering routes
  const { initSearchExtensions } =
    await import('./scripts/init-search-extensions');
  await initSearchExtensions();

  const server = await registerRoutes(app);

  app.use(
    (
      err: Error & { status?: number; statusCode?: number },
      req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || 'Internal Server Error';

      // SECURITY: Log only safe error properties - never full error objects
      // Full error objects can contain request context with auth headers
      console.error('[ERROR]', {
        name: err.name,
        message: message,
        status,
        // Only log stack in development, truncated to first line in production
        ...(process.env.NODE_ENV === 'development'
          ? { stack: err.stack?.split('\n').slice(0, 3).join('\n') }
          : {}),
      });
      logCollector.error('Request error', {
        error: message,
        status,
        // Never log full stack traces in production - they can leak sensitive paths
      });

      // CORS headers are handled by the cors middleware
      res.status(status).json({ message });
      // DO NOT throw after sending response - this would crash the server
    }
  );

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get('env') === 'development') {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(
    {
      port,
      host: '0.0.0.0',
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      logCollector.success(
        `AT Protocol App View service started on port ${port}`
      );
      logCollector.info('Database connection initialized');
      logCollector.info('XRPC endpoints registered and ready');

      // Initialize database health monitoring
      import('./services/database-health').then(({ databaseHealthService }) => {
        databaseHealthService.start().catch((err) => {
          console.error('[DB_HEALTH] Failed to start health monitoring:', err);
        });
      });

      // Initialize cache service
      cacheService
        .connect()
        .then(() => {
          logCollector.info('Redis cache service initialized');
        })
        .catch((err) => {
          console.error('[CACHE] Failed to initialize cache service:', err);
        });

      // Initialize data pruning service (if enabled)
      import('./services/data-pruning').then(
        ({ dataPruningService: _dataPruningService }) => {
          // Service auto-initializes in its constructor
        }
      );

      // TypeScript backfill service is PERMANENTLY DISABLED
      // Backfill functionality has been moved to Python (python-firehose/backfill_service.py)
      // The Python implementation provides better performance and resource management
      // To run backfill, use the Python unified worker with BACKFILL_DAYS environment variable
      console.log(
        '[BACKFILL] TypeScript backfill is permanently disabled. Use Python backfill service instead.'
      );

      // Start background jobs (session cleanup, OAuth cleanup, pool status logging)
      startBackgroundJobs();
    }
  );
})();
