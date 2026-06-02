import { build } from './build.mjs';
import { pagesDeploy } from './deploy-target.mjs';
import { loadState, saveState, STATE_FILE_REPO_PATH } from './state.mjs';
import { tagExists, tagCommit, commitPaths, push, isOffline } from './git.mjs';

const PROD_BRANCH = process.env.CF_PROD_BRANCH || 'production';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function normalizeTag(input) {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 1) {
      throw httpError(400, `n must be a positive integer (got ${input})`);
    }
    return `release/${input}`;
  }
  if (typeof input === 'string') {
    if (/^\d+$/.test(input)) return `release/${input}`;
    if (/^release\/\d+$/.test(input)) return input;
  }
  throw httpError(400, `invalid tag: ${JSON.stringify(input)}`);
}

/**
 * Pure: compute the new release state after deploying newEntry.
 * - dedupe: if newEntry.tag already exists in previous, remove it first
 * - push old current onto previous (front of array) unless it's the same tag
 */
export function applyDeploy(state, newEntry) {
  const previousFiltered = (state.previous ?? []).filter(e => e.tag !== newEntry.tag);
  const newPrevious = (state.current && state.current.tag !== newEntry.tag)
    ? [state.current, ...previousFiltered]
    : previousFiltered;
  return {
    version: 1,
    current: newEntry,
    previous: newPrevious,
  };
}

export async function runDeploy(tagOrN, { onPhase = () => {}, onLog = () => {} } = {}) {
  const tag = normalizeTag(tagOrN);

  if (!(await tagExists(tag))) {
    throw httpError(404, `${tag} does not exist locally`);
  }

  onPhase('phase', { name: 'snapshot', status: 'start' });
  const stateBefore = await loadState();
  onPhase('phase', { name: 'snapshot', status: 'done' });

  onPhase('phase', { name: 'build', status: 'start', ref: tag });
  const buildResult = await build({ ref: tag, target: 'prod' });
  onPhase('phase', {
    name: 'build', status: 'done',
    enabled: buildResult.enabled, baseUrl: buildResult.baseUrl,
  });

  onPhase('phase', { name: 'deploy', status: 'start', branch: PROD_BRANCH });
  const deployResult = await pagesDeploy(buildResult.dist, PROD_BRANCH, { onLog });
  onPhase('phase', {
    name: 'deploy', status: 'done',
    id: deployResult.id, url: deployResult.url,
  });

  const commit = await tagCommit(tag);
  const newEntry = {
    tag,
    commit,
    cfDeployId: deployResult.id ?? null,
    deployedAt: new Date().toISOString(),
    ...(deployResult.url ? { url: deployResult.url } : {}),
  };

  const newState = applyDeploy(stateBefore, newEntry);

  onPhase('phase', { name: 'state', status: 'start' });
  await saveState(newState);
  onPhase('phase', { name: 'state', status: 'done' });

  onPhase('phase', { name: 'commit', status: 'start' });
  try {
    await commitPaths(`deploy ${tag}`, [STATE_FILE_REPO_PATH]);
    onPhase('phase', { name: 'commit', status: 'done' });
  } catch (err) {
    onPhase('phase', { name: 'commit', status: 'error', message: err.message });
  }

  onPhase('phase', { name: 'push', status: 'start' });
  try {
    const pushResult = await push();
    onPhase('phase', { name: 'push', status: 'done', skipped: pushResult.skipped, offline: isOffline() });
  } catch (err) {
    onPhase('phase', { name: 'push', status: 'error', message: err.message });
  }

  return {
    tag,
    commit,
    cfDeployId: newEntry.cfDeployId,
    url: newEntry.url ?? null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: deploy <n | release/N>');
    process.exit(2);
  }
  try {
    const result = await runDeploy(arg, {
      onPhase: (event, data) => console.log(`[${data.name}] ${data.status}${data.url ? ' ' + data.url : ''}`),
      onLog: line => console.log('  ' + line),
    });
    console.log(`\ndeployed ${result.tag} → ${result.url ?? '(no url)'}`);
  } catch (err) {
    console.error(err.message ?? err);
    process.exit(1);
  }
}
