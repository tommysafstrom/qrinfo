import { execFile } from 'node:child_process';
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
