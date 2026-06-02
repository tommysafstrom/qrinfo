import { build } from './build.mjs';
import { pagesDeploy } from './deploy-target.mjs';
import { loadState, saveState, STATE_FILE_REPO_PATH } from './state.mjs';
import { commitPaths, push, isOffline } from './git.mjs';

const PROD_BRANCH = process.env.CF_PROD_BRANCH || 'production';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Pure: pop previous[0] off the stack and make it current.
 * - throws if previous is empty
 * - takes freshEntry so callers can supply the new cfDeployId / deployedAt
 *   from the actual redeploy
 */
export function applyRollback(state, freshEntry) {
  if (!state.previous || state.previous.length === 0) {
    throw httpError(409, 'previous stack is empty — nothing to roll back to');
  }
  return {
    version: 1,
    current: freshEntry,
    previous: state.previous.slice(1),
  };
}

export async function runRollback({ onPhase = () => {}, onLog = () => {} } = {}) {
  onPhase('phase', { name: 'snapshot', status: 'start' });
  const stateBefore = await loadState();
  const target = stateBefore.previous?.[0];
  if (!target) {
    throw httpError(409, 'previous stack is empty — nothing to roll back to');
  }
  onPhase('phase', { name: 'snapshot', status: 'done', target: target.tag });

  onPhase('phase', { name: 'build', status: 'start', ref: target.tag });
  const buildResult = await build({ ref: target.tag, target: 'prod' });
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

  const freshEntry = {
    tag: target.tag,
    commit: target.commit,
    cfDeployId: deployResult.id ?? null,
    deployedAt: new Date().toISOString(),
    ...(deployResult.url ? { url: deployResult.url } : {}),
  };

  const newState = applyRollback(stateBefore, freshEntry);

  onPhase('phase', { name: 'state', status: 'start' });
  await saveState(newState);
  onPhase('phase', { name: 'state', status: 'done' });

  onPhase('phase', { name: 'commit', status: 'start' });
  try {
    await commitPaths(`rollback to ${target.tag}`, [STATE_FILE_REPO_PATH]);
    onPhase('phase', { name: 'commit', status: 'done' });
  } catch (err) {
    onPhase('phase', { name: 'commit', status: 'error', message: err.message });
  }

  onPhase('phase', { name: 'push', status: 'start' });
  try {
    const r = await push();
    onPhase('phase', { name: 'push', status: 'done', skipped: r.skipped, offline: isOffline() });
  } catch (err) {
    onPhase('phase', { name: 'push', status: 'error', message: err.message });
  }

  return {
    rolledBackTo: target.tag,
    commit: target.commit,
    cfDeployId: freshEntry.cfDeployId,
    url: freshEntry.url ?? null,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runRollback({
      onPhase: (_, data) => console.log(`[${data.name}] ${data.status}${data.url ? ' ' + data.url : ''}`),
      onLog: line => console.log('  ' + line),
    });
    console.log(`\nrolled back to ${result.rolledBackTo} → ${result.url ?? '(no url)'}`);
  } catch (err) {
    console.error(err.message ?? err);
    process.exit(1);
  }
}
