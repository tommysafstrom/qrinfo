const TARGET_ENVS = {
  prod: ['QR_BASE_URL_PROD', 'CF_PAGES_URL'],
  staging: ['QR_BASE_URL_STAGING'],
  local: ['QR_BASE_URL_LOCAL', 'QR_BASE_URL'],
};

export const TARGETS = Object.keys(TARGET_ENVS);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function resolveBaseUrl(target) {
  const candidates = TARGET_ENVS[target];
  if (!candidates) throw httpError(400, `unknown target: ${target}`);
  for (const key of candidates) {
    const val = process.env[key];
    if (val) return val.replace(/\/$/, '');
  }
  if (target === 'local') return 'http://localhost:8080';
  throw httpError(
    400,
    `no base URL set for target "${target}"; expected one of ${candidates.join(', ')}`,
  );
}
