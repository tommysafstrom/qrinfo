import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(__dirname, '../..');

export const isOffline = () => process.env.OFFLINE === '1';

let _repoRoot;
async function repoRoot() {
  if (_repoRoot) return _repoRoot;
  const { stdout } = await execFileP('git', ['rev-parse', '--show-toplevel'], { cwd: STATIC });
  _repoRoot = stdout.trim();
  return _repoRoot;
}

async function git(...args) {
  const cwd = await repoRoot();
  return execFileP('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Extract a subtree of a git ref into destDir. Uses `git archive <ref> <prefix>`
// piped through tar so the result is a faithful, working-tree-independent
// snapshot of that path at that ref. `prefix` is repo-relative (e.g. "static");
// destDir receives the contents of that prefix (the prefix dir itself is stripped).
export async function archiveSubtreeToDir(ref, prefix, destDir) {
  const cwd = await repoRoot();
  await import('node:fs/promises').then(fs => fs.mkdir(destDir, { recursive: true }));
  await new Promise((resolveP, reject) => {
    const archive = spawn('git', ['archive', '--format=tar', ref, prefix], { cwd });
    // strip the leading "<prefix>/" so destDir holds the subtree contents directly
    const depth = prefix.split('/').filter(Boolean).length;
    const tar = spawn('tar', ['-x', `--strip-components=${depth}`, '-C', destDir], {
      stdio: ['pipe', 'inherit', 'pipe'],
    });
    let archiveErr = '';
    let tarErr = '';
    archive.stderr.on('data', d => { archiveErr += d.toString(); });
    tar.stderr.on('data', d => { tarErr += d.toString(); });
    archive.stdout.pipe(tar.stdin);
    let archiveDone = false, tarDone = false, failed = false;
    const fail = err => { if (!failed) { failed = true; reject(err); } };
    archive.on('error', fail);
    tar.on('error', fail);
    archive.on('close', code => {
      archiveDone = true;
      if (code !== 0) return fail(new Error(`git archive ${ref} ${prefix} exited ${code}: ${archiveErr.trim()}`));
      if (tarDone) resolveP();
    });
    tar.on('close', code => {
      tarDone = true;
      if (code !== 0) return fail(new Error(`tar extract exited ${code}: ${tarErr.trim()}`));
      if (archiveDone) resolveP();
    });
  });
}

export async function showAtRef(ref, repoRelativePath) {
  try {
    const { stdout } = await git('show', `${ref}:${repoRelativePath}`);
    return stdout;
  } catch (err) {
    const stderr = err.stderr ?? '';
    if (stderr.includes('does not exist') || stderr.includes('exists on disk, but not in')) {
      throw httpError(404, `${repoRelativePath} not found at ref ${ref}`);
    }
    if (stderr.includes('unknown revision') || stderr.includes('bad revision')) {
      throw httpError(404, `unknown git ref: ${ref}`);
    }
    throw err;
  }
}

export async function revParseHead() {
  const { stdout } = await git('rev-parse', 'HEAD');
  return stdout.trim();
}

export async function shortSha(ref) {
  const { stdout } = await git('rev-parse', '--short', ref);
  return stdout.trim();
}

export async function statusPorcelain() {
  const { stdout } = await git('status', '--porcelain');
  return stdout;
}

export async function workingTreeStatus() {
  const raw = await statusPorcelain();
  const lines = raw.split('\n').filter(Boolean);
  return lines.map(line => ({ code: line.slice(0, 2), path: line.slice(3) }));
}

export async function tagExists(tag) {
  try {
    await git('rev-parse', '--verify', `refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

export async function createTag(tag, ref = 'HEAD') {
  if (await tagExists(tag)) {
    throw httpError(409, `tag ${tag} already exists`);
  }
  await git('tag', tag, ref);
}

export async function pushTags() {
  if (isOffline()) return { skipped: true };
  await git('push', '--tags');
  return { skipped: false };
}

export async function commitPaths(message, repoRelativePaths) {
  await git('add', '--', ...repoRelativePaths);
  await git('commit', '-m', message);
}

export async function push() {
  if (isOffline()) return { skipped: true };
  await git('push');
  return { skipped: false };
}

export async function isFileAtRef(repoRelativePath, ref = 'HEAD') {
  try {
    await git('cat-file', '-e', `${ref}:${repoRelativePath}`);
    return true;
  } catch {
    return false;
  }
}

export async function isFileCommittedAndClean(repoRelativePath) {
  if (!(await isFileAtRef(repoRelativePath))) return false;
  try {
    await git('diff', '--quiet', 'HEAD', '--', repoRelativePath);
    return true;
  } catch {
    return false;
  }
}

export async function listReleaseTags() {
  try {
    const { stdout } = await git('tag', '--list', 'release/*', '--sort=-creatordate');
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export async function tagCommit(tag) {
  return shortSha(`refs/tags/${tag}`);
}

export async function commitDate(ref) {
  const { stdout } = await git('log', '-1', '--format=%cI', ref);
  return stdout.trim();
}

// Commits reachable from `to` but not from `from` (i.e. what's new since `from`).
// If `from` is null/undefined, returns the commits for `to` alone (HEAD only here
// would be huge, so callers pass a bounded `to` like HEAD with a real `from`).
// Each commit: { sha (short), subject, date }.
export async function commitsBetween(from, to = 'HEAD') {
  const range = from ? `${from}..${to}` : to;
  let stdout;
  try {
    ({ stdout } = await git('log', '--format=%h\x1f%s\x1f%cI', range));
  } catch {
    return [];
  }
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha, subject, date] = line.split('\x1f');
      return { sha, subject, date };
    });
}

// File-level change summary between two refs, restricted to `static/` so the
// report reflects the deployed site only. Returns { added, modified, deleted }
// counts plus a `files` array of { status: 'A'|'M'|'D'|'R'|..., path }.
export async function diffNameStatus(from, to = 'HEAD', pathspec = 'static') {
  const range = from ? `${from}..${to}` : to;
  let stdout;
  try {
    ({ stdout } = await git('diff', '--name-status', range, '--', pathspec));
  } catch {
    return { added: 0, modified: 0, deleted: 0, files: [] };
  }
  const files = stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [code, ...rest] = line.split('\t');
      return { status: code[0], path: rest[rest.length - 1] };
    });
  return {
    added: files.filter(f => f.status === 'A').length,
    modified: files.filter(f => f.status === 'M' || f.status === 'R' || f.status === 'C').length,
    deleted: files.filter(f => f.status === 'D').length,
    files,
  };
}
