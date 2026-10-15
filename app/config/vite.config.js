import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { idleMinutesFromEnv, createIdleWatch, isLocalRequest } from '../src/server/lifecycle.js';
import { createSessionStore } from '../src/server/telemetryStore.js';
import { readVersion } from '../src/server/version.js';
import { readDeveloperMode, handleCaptureRoute } from '../src/server/captureRoutes.js';

// Project root is app/ (this file lives in app/config/).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// developerMode lives here; read per request so an edit needs no restart (DF-144)
const LAUNCHER_CONFIG = path.join(ROOT, 'config', 'launcher.json');

// The game's port. DEADFALL_PORT overrides it (for tests on a machine whose 5199 is busy); players never set it.
const PORT = Number(process.env.DEADFALL_PORT) || 5199;

// TELEMETRY V2 (the playtest flight recorder, docs/References/Telemetry.md).
// David plays -> the client fire-and-forget POSTs here -> files land in
// gitignored captures/telemetry/ -> Claude reads them off disk. No MCP, no
// browser, no interrupting the player. The actual write/decode logic lives
// in src/server/telemetryStore.js (unit-tested); this plugin is just the
// HTTP glue: read the body, hand it to the pure functions, never throw back
// into the dev server.
function telemetryPlugin() {
  const telemetryDir = path.join(ROOT, 'captures', 'telemetry');
  const sessionStore = createSessionStore(telemetryDir);

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        // safety cap - a single frame/session POST should never approach
        // this; guards against a runaway client, not normal operation
        if (data.length > 30 * 1024 * 1024) {
          reject(new Error('telemetry payload too large'));
          req.destroy();
        }
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  return {
    name: 'deadfall-telemetry',
    configureServer: attach,
    // player mode serves the built bundle with 'vite preview': same endpoints, so telemetry stays on
    configurePreviewServer: attach,
  };

  function attach(server) {
    {
      server.middlewares.use(async (req, res, next) => {
        // the page reads the developer flag once at start (src/game/developerMode.js)
        if (req.method === 'GET' && req.url === '/api/config') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ developerMode: readDeveloperMode(LAUNCHER_CONFIG) }));
          return;
        }

        if (req.method !== 'POST') return next();

        if (req.url === '/telemetry') {
          try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            // delta or legacy full snapshot; resolves once the file is durably written
            const result = await sessionStore.apply(payload);
            res.statusCode = result.ok ? 200 : 409;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ lens: result.lens }));
          } catch (err) {
            console.error('[telemetry] /telemetry write failed:', err.message);
            res.statusCode = 500;
            res.end();
          }
          return;
        }

        // Frames and named captures (screenshots, contact sheets, recordings)
        // are developer-only: 403 and no file unless launcher.json developerMode is true.
        if (req.url === '/telemetry/frame' || req.url === '/telemetry/capture') {
          try {
            const body = await readBody(req);
            res.statusCode = handleCaptureRoute(req.url, body, { telemetryDir, configPath: LAUNCHER_CONFIG });
            res.end();
          } catch (err) {
            console.error(`[telemetry] ${req.url} write failed:`, err.message);
            res.statusCode = 500;
            res.end();
          }
          return;
        }

        next();
      });
    }
  }
}

// HIDDEN SERVER LIFECYCLE (docs/Guides/LaunchAndUpdate.md). launch.bat starts
// this server with no window, so the page must be able to stop it:
//   GET  /api/ping  - the open page says "still here" every ~30 s (not logged)
//   POST /api/quit  - the Quit button; answers 204, then the process exits
//   GET  /api/version - the build version {sha, date, short, label}, read once at server start (app/VERSION or git)
// If no page pings for DEADFALL_IDLE_MINUTES (default 10) the server exits by
// itself so a closed tab never leaves an orphan. logs/server.pid holds the
// node PID while it runs; logs/server.log gets one line per lifecycle event.
function lifecyclePlugin() {
  const logsDir = path.join(ROOT, 'logs');
  const pidFile = path.join(logsDir, 'server.pid');
  // computed once at start: never spawn git per request
  const version = readVersion(path.resolve(ROOT, '..'));
  const versionJson = JSON.stringify(version);

  // Lifecycle events go to stdout: launch.bat redirects stdout to logs/server.log, and a second
  // writer appending to that file would be overwritten by the redirected handle.
  function log(line) {
    console.log(`[${new Date().toISOString()}] ${line}`);
  }

  function removePid() {
    try {
      if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.rmSync(pidFile);
    } catch {
      // already gone
    }
  }

  function shutdown(reason) {
    log(reason);
    removePid();
    process.exit(0);
  }

  function attach(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/api/version' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(versionJson);
        return;
      }
      next();
    });
    // vitest also builds a dev server from this config: never write a PID file or self-exit there
    if (process.env.VITEST) return;
    const idleMinutes = idleMinutesFromEnv(process.env);
    const idle = createIdleWatch(idleMinutes * 60000);

    server.middlewares.use((req, res, next) => {
      if (req.url === '/api/ping' && req.method === 'GET') {
        idle.ping();
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.url === '/api/quit' && req.method === 'POST') {
        const local = isLocalRequest({
          remoteAddress: req.socket.remoteAddress,
          host: req.headers.host,
          origin: req.headers.origin,
        });
        if (!local) {
          res.statusCode = 403;
          res.end();
          return;
        }
        res.statusCode = 204;
        res.on('finish', () => shutdown('quit requested'));
        res.end();
        return;
      }
      next();
    });

    const start = () => {
      try {
        fs.mkdirSync(logsDir, { recursive: true });
        fs.writeFileSync(pidFile, String(process.pid));
      } catch {
        // the PID file is a convenience for update.bat; the server still works without it
      }
      log(`server listening (pid ${process.pid}, idle exit after ${idleMinutes} min)`);
      log(`version ${version.sha ?? version.label} ${version.date ?? ''}`.trimEnd());
    };
    if (server.httpServer) server.httpServer.once('listening', start);

    const timer = setInterval(() => {
      if (idle.expired()) shutdown(`idle exit: no page pinged for ${idleMinutes} min`);
    }, Math.max(250, Math.min(5000, idleMinutes * 30000)));
    timer.unref();
    process.on('exit', removePid);
  }

  return {
    name: 'deadfall-lifecycle',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  root: ROOT,
  publicDir: path.join(ROOT, 'assets'),
  plugins: [lifecyclePlugin(), telemetryPlugin()],
  server: {
    port: PORT,
    strictPort: true,
  },
  preview: {
    port: PORT,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // three.js alone is over the default 500 kB warning; the game ships as one bundle on purpose
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
