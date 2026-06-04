import { ZodError } from 'zod';

import {
  loadCodes,
  addCode,
  replaceCode,
  patchCode,
  deleteCode,
} from './codes.mjs';
import { resolveBaseUrl, TARGETS } from './baseUrl.mjs';
import { pngBuffer, svgString } from './qr.mjs';
import { loadState } from './state.mjs';
import { diffCodes } from './diff.mjs';
import { showAtRef } from './git.mjs';
import { codesJsonSchema } from './schema.mjs';
import { runPreview } from './preview.mjs';
import { createReleaseTag, listReleases, suggestNextN, workingTreeReport, nextReleasePreview } from './tag.mjs';
import { runDeploy } from './deploy.mjs';
import { runRollback } from './rollback.mjs';

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error('invalid JSON body'), { status: 400 }); }
}

async function getCodes(_req, res) {
  sendJson(res, 200, await loadCodes());
}

async function postCodes(req, res, ctx) {
  const body = await ctx.readBody(req);
  if (!body) throw Object.assign(new Error('body required'), { status: 400 });
  const created = await addCode(body);
  sendJson(res, 201, created);
}

async function putCode(req, res, ctx) {
  const body = await ctx.readBody(req);
  if (!body) throw Object.assign(new Error('body required'), { status: 400 });
  const updated = await replaceCode(ctx.params[0], body);
  sendJson(res, 200, updated);
}

async function patchCodeHandler(req, res, ctx) {
  const body = await ctx.readBody(req);
  if (!body) throw Object.assign(new Error('body required'), { status: 400 });
  const updated = await patchCode(ctx.params[0], body);
  sendJson(res, 200, updated);
}

async function deleteCodeHandler(_req, res, ctx) {
  const result = await deleteCode(ctx.params[0]);
  sendJson(res, 200, result);
}

async function getQr(_req, res, ctx) {
  const slug = ctx.params[0];
  const format = (ctx.url.searchParams.get('format') ?? 'png').toLowerCase();
  const target = (ctx.url.searchParams.get('target') ?? 'local').toLowerCase();
  const sizeRaw = ctx.url.searchParams.get('size');
  const size = sizeRaw ? Math.max(40, Math.min(2048, Number(sizeRaw))) : undefined;

  if (!['png', 'svg'].includes(format)) {
    throw Object.assign(new Error(`format must be png or svg`), { status: 400 });
  }
  if (!TARGETS.includes(target)) {
    throw Object.assign(new Error(`target must be one of ${TARGETS.join(', ')}`), { status: 400 });
  }

  const doc = await loadCodes();
  const code = doc.codes.find(c => c.slug === slug);
  if (!code) throw Object.assign(new Error(`code "${slug}" not found`), { status: 404 });

  const base = resolveBaseUrl(target);
  const url = `${base}/q/${code.slug}`;

  if (format === 'svg') {
    const svg = await svgString(url);
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': `inline; filename="${slug}.svg"`,
    });
    res.end(svg);
  } else {
    const buf = await pngBuffer(url, { size });
    res.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'content-disposition': `inline; filename="${slug}.png"`,
      'content-length': buf.length,
    });
    res.end(buf);
  }
}

async function getState(_req, res) {
  sendJson(res, 200, await loadState());
}

async function getDiff(_req, res) {
  const after = await loadCodes();
  const state = await loadState();

  let before = null;
  const baseline = { kind: 'empty', tag: null, commit: null };

  if (state.current) {
    baseline.kind = 'current';
    baseline.tag = state.current.tag;
    baseline.commit = state.current.commit;
    try {
      const text = await showAtRef(state.current.commit, 'static/codes.json');
      before = codesJsonSchema.parse(JSON.parse(text));
    } catch (err) {
      baseline.kind = 'stale';
      baseline.error = err.message;
    }
  }

  const diff = diffCodes(before, after);
  sendJson(res, 200, { baseline, ...diff });
}

function sseWriter(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });
  return (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

async function getReleases(_req, res) {
  const releases = await listReleases();
  const nextN = suggestNextN(releases);
  const workingTree = await workingTreeReport();
  const nextRelease = await nextReleasePreview();
  sendJson(res, 200, { releases, nextN, workingTree, nextRelease });
}

async function postTag(req, res, ctx) {
  const body = await ctx.readBody(req);
  if (!body) throw Object.assign(new Error('body required'), { status: 400 });
  if (typeof body.n !== 'number') {
    throw Object.assign(new Error('body must include {"n": <integer>}'), { status: 400 });
  }
  const result = await createReleaseTag(body.n);
  sendJson(res, 201, result);
}

async function postPreview(_req, res) {
  const send = sseWriter(res);
  try {
    const result = await runPreview({
      onPhase: (event, data) => send(event, data),
      onLog: line => send('log', { line }),
    });
    send('done', result);
  } catch (err) {
    send('error', { message: err.message ?? String(err) });
  } finally {
    res.end();
  }
}

async function postDeploy(req, res, ctx) {
  const send = sseWriter(res);
  try {
    const body = await ctx.readBody(req);
    if (!body) throw Object.assign(new Error('body required'), { status: 400 });
    const tag = body.tag ?? (typeof body.n === 'number' ? `release/${body.n}` : null);
    if (!tag) throw Object.assign(new Error('body must include {tag} or {n}'), { status: 400 });

    const result = await runDeploy(tag, {
      onPhase: (event, data) => send(event, data),
      onLog: line => send('log', { line }),
    });
    send('done', result);
  } catch (err) {
    send('error', { message: err.message ?? String(err), status: err.status });
  } finally {
    res.end();
  }
}

async function postRollback(_req, res) {
  const send = sseWriter(res);
  try {
    const result = await runRollback({
      onPhase: (event, data) => send(event, data),
      onLog: line => send('log', { line }),
    });
    send('done', result);
  } catch (err) {
    send('error', { message: err.message ?? String(err), status: err.status });
  } finally {
    res.end();
  }
}

const NOT_IMPLEMENTED = (_req, res) =>
  sendJson(res, 501, { error: 'not implemented in this phase' });

const ROUTES = [
  { method: 'GET',    pattern: /^\/api\/codes$/,                handler: getCodes },
  { method: 'POST',   pattern: /^\/api\/codes$/,                handler: postCodes },
  { method: 'PUT',    pattern: /^\/api\/codes\/([a-z0-9-]+)$/,  handler: putCode },
  { method: 'PATCH',  pattern: /^\/api\/codes\/([a-z0-9-]+)$/,  handler: patchCodeHandler },
  { method: 'DELETE', pattern: /^\/api\/codes\/([a-z0-9-]+)$/,  handler: deleteCodeHandler },
  { method: 'GET',    pattern: /^\/api\/state$/,                handler: getState },
  { method: 'GET',    pattern: /^\/api\/diff$/,                 handler: getDiff },
  { method: 'GET',    pattern: /^\/api\/releases$/,             handler: getReleases },
  { method: 'GET',    pattern: /^\/api\/qr\/([a-z0-9-]+)$/,     handler: getQr },
  { method: 'POST',   pattern: /^\/api\/preview$/,              handler: postPreview, sse: true },
  { method: 'POST',   pattern: /^\/api\/tag$/,                  handler: postTag },
  { method: 'POST',   pattern: /^\/api\/deploy$/,               handler: postDeploy, sse: true },
  { method: 'POST',   pattern: /^\/api\/rollback$/,             handler: postRollback, sse: true },
];

export async function handleApi(req, res, url) {
  const { pathname } = url;
  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const m = pathname.match(route.pattern);
    if (!m) continue;
    try {
      await route.handler(req, res, { params: m.slice(1), url, readBody });
    } catch (err) {
      if (route.sse) {
        if (!res.writableEnded) res.end();
        console.error('sse handler error', req.method, pathname, err);
        return;
      }
      if (err instanceof ZodError) {
        sendJson(res, 400, {
          error: 'validation failed',
          issues: err.issues.map(i => ({ path: i.path, message: i.message })),
        });
        return;
      }
      const status = err.status ?? 500;
      if (status >= 500) console.error('api error', req.method, pathname, err);
      sendJson(res, status, { error: err.message ?? 'internal error' });
    }
    return;
  }
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  sendJson(res, 404, { error: `no route for ${req.method} ${pathname}` });
}
