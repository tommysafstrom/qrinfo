import { build } from './build.mjs';
import { pagesDeploy } from './deploy-target.mjs';

const STAGING_BRANCH = process.env.CF_STAGING_BRANCH || 'staging';

export async function runPreview({ onPhase = () => {}, onLog = () => {} } = {}) {
  onPhase('phase', { name: 'build', status: 'start' });
  const buildResult = await build({ target: 'staging' });
  onPhase('phase', {
    name: 'build',
    status: 'done',
    enabled: buildResult.enabled,
    disabled: buildResult.disabled,
    baseUrl: buildResult.baseUrl,
  });

  onPhase('phase', { name: 'deploy', status: 'start', branch: STAGING_BRANCH });
  const deployResult = await pagesDeploy(buildResult.dist, STAGING_BRANCH, { onLog });
  onPhase('phase', {
    name: 'deploy',
    status: 'done',
    id: deployResult.id,
    url: deployResult.url,
  });

  return {
    enabled: buildResult.enabled,
    deployId: deployResult.id,
    url: deployResult.url,
  };
}
