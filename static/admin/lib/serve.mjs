// Local redirect server for the static QR site.
//
// Reads dist/_redirects and applies its rules — real HTTP 302 for redirects,
// status-200 entries as rewrites (serve the target file, keep the URL).
// Falls back to serving anything else under dist/ as a static file, and to
// dist/not-found.html for unmatched paths.
//
// Default binding is 0.0.0.0 so phones on the same Wi-Fi can reach it. Set
// SERVE_HOST=127.0.0.1 to restrict to loopback.
//
// Used in two places:
//   1. laptop dev preview — `npm run build && npm run serve`
//   2. Pi-LAN dry run — pm2-supervised on the Pi, phones scan against it
//
// See plans/static-site.md Phase 4.1.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildScanEvent, buildPageview, sendUmami } from './track.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(__dirname, '../..');
const DIST = process.env.SERVE_DIST
  ? resolve(process.env.SERVE_DIST)
  : resolve(STATIC, 'dist');

const PORT = Number(process.env.SERVE_PORT ?? process.env.PORT ?? 8080);
const HOST = process.env.SERVE_HOST ?? '0.0.0.0';

// Scan analytics (Option A). All env-gated: no-op unless UMAMI_HOST is set.
const ENV = process.env.QRINFO_ENV ?? 'local';
const TRUST_PROXY = process.env.SERVE_TRUST_PROXY === '1';
const UMAMI = {
  host: process.env.UMAMI_HOST ?? null,
  websiteId: process.env.UMAMI_WEBSITE_ID ?? null,
  debug: process.env.UMAMI_DEBUG === '1',
};
// Build version stamped onto each event; from QRINFO_ENV override or version.json.
let VERSION = process.env.QRINFO_VERSION ?? null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function parseRules(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [from, to, statusStr = '302'] = parts;
    const status = Number.parseInt(statusStr, 10);
    if (!Number.isFinite(status)) continue;
    const isWildcard = from.endsWith('/*');
    const prefix = isWildcard ? from.slice(0, -1) : null;
    rules.push({ from, to, status, isWildcard, prefix });
  }
  return rules;
}

async function loadRules() {
  try {
    const text = await readFile(resolve(DIST, '_redirects'), 'utf8');
    return parseRules(text);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function matchRule(pathname, rules) {
  for (const rule of rules) {
    if (rule.isWildcard) {
      if (pathname.startsWith(rule.prefix)) return rule;
    } else if (pathname === rule.from) {
      return rule;
    }
  }
  return null;
}

function safeResolve(pathname) {
  const candidate = pathname === '' || pathname === '/' ? '/index.html' : pathname;
  const full = resolve(DIST, '.' + candidate);
  const rel = relative(DIST, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

// HTML and JS drive what the user actually sees (scan.html/scan.js, index.html,
// info pages). They must reflect the live release immediately after a deploy or
// rollback, so they're served uncacheable. Static assets (QR images, CSS, the
// vendored ZXing bundle, the codes registry) are safe to cache at the edge and
// in the browser. `must-revalidate` keeps any intermediary honest about the TTL.
const NO_CACHE_EXT = new Set(['.html', '.js']);
function cacheControlFor(filePath) {
  return NO_CACHE_EXT.has(extname(filePath))
    ? 'no-store, must-revalidate'
    : 'public, max-age=300, must-revalidate';
}

async function serveFile(res, filePath, status = 200) {
  if (!filePath) return false;
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return false;
    const data = await readFile(filePath);
    res.writeHead(status, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': cacheControlFor(filePath),
      'x-content-type-options': 'nosniff',
      'content-length': data.length,
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function sendText(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

// Visitor IP. Only trust an inbound X-Forwarded-For when explicitly behind a
// proxy (e.g. nginx) — otherwise a client could spoof it. Default: the real peer.
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '';
}

// Fire a scan event for a matched /q/ redirect. Fire-and-forget — never awaited,
// never touches the response. `rule.isWildcard` is the /q/* not-found fallback.
function trackScan(req, pathname, rule) {
  if (!UMAMI.host) return; // env-gated: no-op unless configured
  const slug = pathname.slice('/q/'.length);
  const hit = !rule.isWildcard;
  const type = rule.to.startsWith('/info/') ? 'internal' : 'external';
  const common = {
    host: UMAMI.host,
    websiteId: UMAMI.websiteId,
    userAgent: req.headers['user-agent'],
    ip: clientIp(req),
    debug: UMAMI.debug,
  };
  // custom event — carries hit/miss + slug/target/type/env/version
  sendUmami(fetch, { ...common, payload: buildScanEvent({ slug, target: rule.to, type, hit, env: ENV, version: VERSION }) });
  // bare pageview — so /q/<code> appears in Umami's standard Pages/URLs report
  sendUmami(fetch, { ...common, payload: buildPageview({ slug }) });
}

let rules = [];

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  // 1. Match _redirects rules first
  const rule = matchRule(pathname, rules);
  if (rule) {
    if (rule.status === 200) {
      // Rewrite — serve the target file, keep the URL
      const file = safeResolve(rule.to);
      if (!(await serveFile(res, file))) return sendText(res, 404, 'rewrite target missing');
      return;
    }
    if (pathname.startsWith('/q/')) trackScan(req, pathname, rule);
    res.writeHead(rule.status, {
      location: rule.to,
      'cache-control': 'no-store',
    });
    res.end();
    return;
  }

  // 2. Static file under dist/
  const file = safeResolve(pathname);
  if (file && (await serveFile(res, file))) return;

  // 3. Fallback to not-found.html (still 404 status)
  const notFound = resolve(DIST, 'not-found.html');
  if (await serveFile(res, notFound, 404)) return;

  // 4. Last-ditch plain 404
  sendText(res, 404, 'not found');
}

const server = createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    console.error('serve error', req.method, req.url, err);
    if (!res.headersSent) sendText(res, 500, 'internal error');
  }
});

async function start() {
  try {
    await stat(DIST);
  } catch {
    console.error(`dist/ not found at ${DIST}`);
    console.error('run `npm run build` first');
    process.exit(1);
  }
  rules = await loadRules();
  if (rules.length === 0) {
    console.warn(`warning: no rules loaded from dist/_redirects — only static files will be served`);
  } else {
    console.log(`loaded ${rules.length} rule(s) from dist/_redirects`);
  }

  if (VERSION === null) {
    try {
      const v = JSON.parse(await readFile(resolve(DIST, 'version.json'), 'utf8'));
      VERSION = v.tag ?? v.ref ?? v.version ?? null;
    } catch { /* no version.json — leave null */ }
  }
  if (UMAMI.host) {
    console.log(`umami: ${UMAMI.debug ? 'DEBUG (console only)' : UMAMI.host} · env=${ENV} · version=${VERSION ?? '(unknown)'}`);
  } else {
    console.log(`umami: disabled (UMAMI_HOST unset) · env=${ENV}`);
  }
  server.listen(PORT, HOST, () => {
    console.log(`serving ${DIST} on http://${HOST}:${PORT}`);
    if (HOST === '0.0.0.0') {
      console.log('  (binding all interfaces — reachable from the LAN; set SERVE_HOST=127.0.0.1 to restrict)');
    }
    console.log('press Ctrl-C to stop');
  });
}

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

start();
