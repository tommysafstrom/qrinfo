import {
  isFileCommittedAndClean,
  createTag,
  pushTags,
  tagExists,
  listReleaseTags,
  tagCommit,
  commitDate,
} from './git.mjs';

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
