import {
  isFileCommittedAndClean,
  createTag,
  pushTags,
  tagExists,
  listReleaseTags,
  tagCommit,
  commitDate,
  commitsBetween,
  diffNameStatus,
} from './git.mjs';
import { loadState } from './state.mjs';

// Files that must be committed at HEAD before a tag can be created.
// (release-state.json is mutated during deploy, not at tag time, so it's not
// required here.)
const REQUIRED_CLEAN = ['static/codes.json'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function uncleanFiles() {
  const dirty = [];
  for (const path of REQUIRED_CLEAN) {
    if (!(await isFileCommittedAndClean(path))) dirty.push(path);
  }
  return dirty;
}

export async function workingTreeReport() {
  const dirty = await uncleanFiles();
  return { clean: dirty.length === 0, dirtyFiles: dirty };
}

export async function createReleaseTag(n, { push = true } = {}) {
  if (!Number.isInteger(n) || n < 1) {
    throw httpError(400, `n must be a positive integer (got ${n})`);
  }
  const tag = `release/${n}`;
  if (await tagExists(tag)) {
    throw httpError(409, `${tag} already exists`);
  }
  const dirty = await uncleanFiles();
  if (dirty.length > 0) {
    throw httpError(
      409,
      `cannot tag: ${dirty.join(', ')} is not committed at HEAD — commit first`,
    );
  }
  await createTag(tag);
  let pushResult = { skipped: !push };
  if (push) pushResult = await pushTags();
  return {
    tag,
    commit: await tagCommit(tag),
    pushed: push && !pushResult.skipped,
  };
}

export async function listReleases() {
  const tags = await listReleaseTags();
  const out = [];
  for (const tag of tags) {
    try {
      out.push({
        tag,
        commit: await tagCommit(tag),
        date: await commitDate(tag),
      });
    } catch {
      // skip a malformed tag
    }
  }
  return out;
}

// What a new release would contain: every commit and static/ file change
// between the currently-live release commit and HEAD. The baseline is the
// commit recorded in release-state.json (`current`); if nothing is live yet,
// there's no bounded baseline so we report "first release".
export async function nextReleasePreview() {
  const state = await loadState();
  const baseCommit = state.current?.commit ?? null;
  const baseTag = state.current?.tag ?? null;

  if (!baseCommit) {
    return {
      firstRelease: true,
      baseTag: null,
      baseCommit: null,
      commits: [],
      files: { added: 0, modified: 0, deleted: 0, files: [] },
    };
  }

  const commits = await commitsBetween(baseCommit, 'HEAD');
  const files = await diffNameStatus(baseCommit, 'HEAD', 'static');
  return { firstRelease: false, baseTag, baseCommit, commits, files };
}

export function suggestNextN(releases) {
  let max = 0;
  for (const r of releases) {
    const m = r.tag.match(/^release\/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: tag <n>');
    process.exit(2);
  }
  try {
    const result = await createReleaseTag(Number(arg));
    console.log(`tagged ${result.tag} → ${result.commit}${result.pushed ? ' (pushed)' : ' (push skipped)'}`);
  } catch (err) {
    console.error(err.message ?? err);
    process.exit(1);
  }
}
