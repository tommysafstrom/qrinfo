import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { randomBytes } from 'node:crypto';

import { handleApi } from './lib/api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, 'public');
const PORT = Number(process.env.PORT ?? 5173);
const HOST = '127.0.0.1';

// Per-launch random URL prefix — belt-and-suspenders against blind cross-app
// localhost probes if the loopback isolation is somehow bypassed.
// Disable with NO_TOKEN=1 for testing.
const TOKEN = process.env.NO_TOKEN === '1' ? '' : randomBytes(16).toString('hex');
const PATH_PREFIX = TOKEN ? `/${TOKEN}` : '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

async function serveStatic(_req, res, pathname) {
  const candidate = pathname === '/' ? '/index.html' : pathname;
  const full = resolve(PUBLIC_DIR, '.' + candidate);
  const rel = relative(PUBLIC_DIR, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return send(res, 403, 'forbidden');
  try {
    const st = await stat(full);
    if (!st.isFile()) return send(res, 404, 'not found');
    const data = await readFile(full);
    const ct = MIME[extname(full)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    send(res, 404, 'not found');
  }
}

function openBrowser(url) {
  const cmd = {
    darwin: `open "${url}"`,
    linux: `xdg-open "${url}"`,
    win32: `start "" "${url}"`,
  }[platform()];
  if (cmd) exec(cmd, () => {});
}

function stripPrefix(pathname) {
  if (!PATH_PREFIX) return pathname;
  if (pathname === PATH_PREFIX) return null;          // need trailing-slash redirect
  if (pathname.startsWith(PATH_PREFIX + '/')) {
    return pathname.slice(PATH_PREFIX.length);
  }
  return undefined;                                   // not under our prefix
}

const server = createServer(async (req, res) => {
  const remote = req.socket.remoteAddress;
  if (!LOOPBACK.has(remote)) {
    return send(res, 403, `forbidden (non-loopback: ${remote})`);
  }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const stripped = stripPrefix(url.pathname);
  if (stripped === undefined) return send(res, 404, 'not found');
  if (stripped === null) {
    res.writeHead(302, { location: PATH_PREFIX + '/' });
    return res.end();
  }
  const routeUrl = new URL(stripped + url.search, `http://${HOST}:${PORT}`);
  try {
    if (stripped.startsWith('/api/')) {
      await handleApi(req, res, routeUrl);
    } else {
      await serveStatic(req, res, stripped);
    }
  } catch (err) {
    console.error('handler error', req.method, req.url, err);
    if (!res.headersSent) send(res, 500, 'internal error');
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}${PATH_PREFIX}/`;
  console.log(`admin tool listening on ${url}`);
  if (TOKEN) {
    console.log('  (per-launch URL token — keep this URL private to this session)');
  }
  console.log('press Ctrl-C to stop');
  if (!process.env.NO_OPEN) openBrowser(url);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log('\nshutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
