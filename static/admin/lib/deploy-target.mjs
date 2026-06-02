// Picks between deploy implementations at call time.
// Default: wrangler (Cloudflare). Set DEPLOY_TARGET=pi to deploy to the Pi.

import * as wrangler from './wrangler.mjs';
import * as pi from './pi-deploy.mjs';

export function pagesDeploy(...args) {
  return currentTarget().pagesDeploy(...args);
}

export function currentTargetName() {
  return process.env.DEPLOY_TARGET === 'pi' ? 'pi' : 'wrangler';
}

function currentTarget() {
  return process.env.DEPLOY_TARGET === 'pi' ? pi : wrangler;
}
