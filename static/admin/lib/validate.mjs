/**
 * Optional pre-deploy checks against external targets.
 * Not wired into deploy/preview by default — call explicitly with an opt-in flag.
 *
 * Returns an array of results; never throws on a target's failure (so a flaky
 * Wikipedia rate-limit doesn't block a deploy).
 */

export async function headCheck(url, { timeout = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkExternalTargets(codes, { onCheck = () => {} } = {}) {
  const external = codes.filter(c => c.enabled && c.type === 'external');
  const results = [];
  for (const c of external) {
    const id = `${c.customerId}-${c.qid}`;
    onCheck(id);
    const r = await headCheck(c.target);
    results.push({ id, target: c.target, ...r });
  }
  return results;
}
