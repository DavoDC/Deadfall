import { defineConfig } from 'vite';
import path from 'node:path';
import { writeSession, writeFrame, writeCapture } from './src/server/telemetryStore.js';

// TELEMETRY V2 (the playtest flight recorder, docs/telemetry-v2-spec.md).
// David plays -> the client fire-and-forget POSTs here -> files land in
// gitignored captures/telemetry/ -> Claude reads them off disk. No MCP, no
// browser, no interrupting the player. The actual write/decode logic lives
// in src/server/telemetryStore.js (unit-tested); this plugin is just the
// HTTP glue: read the body, hand it to the pure functions, never throw back
// into the dev server.
function telemetryPlugin() {
  const telemetryDir = path.join(process.cwd(), 'captures', 'telemetry');

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
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST') return next();

        if (req.url === '/telemetry') {
          try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            writeSession(telemetryDir, payload);
            res.statusCode = 204;
            res.end();
          } catch (err) {
            console.error('[telemetry] /telemetry write failed:', err.message);
            res.statusCode = 500;
            res.end();
          }
          return;
        }

        if (req.url === '/telemetry/frame') {
          try {
            const body = await readBody(req);
            const { startedAt, t, dataURL } = JSON.parse(body);
            writeFrame(telemetryDir, startedAt, t, dataURL);
            res.statusCode = 204;
            res.end();
          } catch (err) {
            console.error('[telemetry] /telemetry/frame write failed:', err.message);
            res.statusCode = 500;
            res.end();
          }
          return;
        }

        // Generic named-capture sink for capture tooling that isn't a
        // numbered session frame (trailer recordings, screenshot rig
        // exports) - see src/capture/save.js for the client side.
        if (req.url === '/telemetry/capture') {
          try {
            const body = await readBody(req);
            const { subdir, filename, dataURL } = JSON.parse(body);
            writeCapture(telemetryDir, subdir, filename, dataURL);
            res.statusCode = 204;
            res.end();
          } catch (err) {
            console.error('[telemetry] /telemetry/capture write failed:', err.message);
            res.statusCode = 500;
            res.end();
          }
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [telemetryPlugin()],
  server: {
    port: 5199,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
