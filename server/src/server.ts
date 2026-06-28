/**
 * server.ts
 *
 * Entry point for the Divya TextStyler API server.
 *
 * Middleware stack (in order):
 *   1. dotenv     — loads .env before any other module reads process.env
 *   2. helmet     — sets 14 security-hardening HTTP response headers
 *   3. cors       — restricts cross-origin requests to the configured whitelist
 *   4. express.json — parses JSON bodies with a 10 MB size ceiling
 *   5. Request logger — lightweight structured request log (no third-party dep)
 *   6. API routes — mounted under /api
 *   7. 404 handler — catches unknown routes before the global error handler
 *   8. Global error handler — formats all unhandled errors as JSON
 */

import 'dotenv/config';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import helmet from 'helmet';
import cors from 'cors';
import textProcessorRouter from './routes/textProcessor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Environment resolution
// ─────────────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const NODE_ENV = process.env['NODE_ENV'] ?? 'development';

/**
 * Parse the ALLOWED_ORIGINS environment variable into an array.
 * Falls back to the two standard Vite dev server origins if the variable is
 * not set so the developer experience works without any configuration.
 */
const parseAllowedOrigins = (): string[] => {
  const raw = process.env['ALLOWED_ORIGINS'];
  if (!raw) {
    return ['http://localhost:5173', 'http://localhost:4173'];
  }
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
};

const ALLOWED_ORIGINS = parseAllowedOrigins();

// ─────────────────────────────────────────────────────────────────────────────
// Express app setup
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// ── 1. Security headers (Helmet) ─────────────────────────────────────────────
// Helmet sets Content-Security-Policy, X-Frame-Options, X-Content-Type-Options,
// Strict-Transport-Security, and 10 other headers by default.
app.use(
  helmet({
    // Allow the frontend to call the API from a browser
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Disable HSTS in development to avoid localhost certificate issues
    strictTransportSecurity: NODE_ENV === 'production',
  })
);

// ── 2. CORS ───────────────────────────────────────────────────────────────────
// Restricted to the configured frontend origins. Any other origin receives a
// 403 before the request body is parsed, blocking cross-site abuse.
app.use(
  cors({
    origin: (incomingOrigin, callback) => {
      // Allow server-to-server requests (no Origin header) and curl testing
      if (!incomingOrigin) {
        callback(null, true);
        return;
      }
      if (ALLOWED_ORIGINS.includes(incomingOrigin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Blocked request from disallowed origin: ${incomingOrigin}`);
        callback(new Error(`Origin '${incomingOrigin}' is not allowed by CORS policy.`));
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    // Expose no custom response headers to the browser
    exposedHeaders: [],
    // Browsers cache the preflight result for 10 minutes
    maxAge: 600,
  })
);

// ── 3. Body parsing ───────────────────────────────────────────────────────────
// 10 MB limit to safely process large devotional texts with extensive Unicode.
// Requests exceeding this limit receive 413 Payload Too Large automatically.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// ── 4. Structured request logger ──────────────────────────────────────────────
// Emits a concise JSON log line for every incoming request.
// Intentionally avoids morgan to keep the dependency tree minimal.
app.use((req: Request, _res: Response, next: NextFunction): void => {
  const ts = new Date().toISOString();
  console.info(`[${ts}] ${req.method} ${req.path} — origin: ${req.headers['origin'] ?? 'none'}`);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────

// Root health check — confirms the server is alive
app.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({
    service: 'Divya TextStyler API',
    version: '1.0.0',
    environment: NODE_ENV,
    endpoints: {
      processText: 'POST /api/process-text',
      processorHealth: 'GET  /api/process-text/health',
    },
  });
});

// Text processing routes
app.use('/api/process-text', textProcessorRouter);

// ─────────────────────────────────────────────────────────────────────────────
// 404 — Unknown route handler
// ─────────────────────────────────────────────────────────────────────────────

app.use((req: Request, res: Response): void => {
  res.status(404).json({
    error: 'Not Found',
    message: `No route matches ${req.method} ${req.path}`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler
// Must have 4 parameters for Express to recognise it as an error handler.
// ─────────────────────────────────────────────────────────────────────────────

app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    // CORS errors are surfaced here by the cors() middleware
    if (err.message.includes('CORS')) {
      res.status(403).json({ error: 'Forbidden', message: err.message });
      return;
    }

    // JSON parse errors from express.json()
    if ('type' in err && (err as Record<string, unknown>)['type'] === 'entity.parse.failed') {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid JSON body.' });
      return;
    }

    // Payload too large
    if ('status' in err && (err as Record<string, unknown>)['status'] === 413) {
      res.status(413).json({
        error: 'Payload Too Large',
        message: 'Request body exceeds the 10 MB limit.',
      });
      return;
    }

    // Generic 500
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message:
        NODE_ENV === 'development'
          ? err.message
          : 'An unexpected error occurred. Please try again.',
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.info('');
  console.info('╔══════════════════════════════════════════════════════════╗');
  console.info('║         🪔  Divya TextStyler API Server                  ║');
  console.info('╠══════════════════════════════════════════════════════════╣');
  console.info(`║  Listening on  → http://localhost:${PORT}                    ║`);
  console.info(`║  Environment   → ${NODE_ENV.padEnd(39)}║`);
  console.info(`║  Allowed origins:                                        ║`);
  ALLOWED_ORIGINS.forEach((o) =>
    console.info(`║    ${o.padEnd(55)}║`)
  );
  console.info(`║  Gemini model  → gemini-2.5-flash                       ║`);
  console.info(`║  Gemini key    → ${(process.env['GEMINI_API_KEY'] ? '✓ configured' : '✗ NOT SET — fallback mode').padEnd(39)}║`);
  console.info('╚══════════════════════════════════════════════════════════╝');
  console.info('');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Closes active connections cleanly on SIGTERM (Docker / Kubernetes) and
// SIGINT (Ctrl-C during development) to prevent connection reset errors.
const shutdown = (signal: string) => {
  console.info(`\n[Server] Received ${signal} — shutting down gracefully…`);
  server.close(() => {
    console.info('[Server] All connections closed. Exiting.');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long (e.g. hung WebSocket)
  setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch unhandled promise rejections and uncaught exceptions so the process
// does not crash silently in production.
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
  process.exit(1);
});

export default app;
