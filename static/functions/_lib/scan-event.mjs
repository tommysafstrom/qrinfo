// Shapes one Workers Analytics Engine (WAE) data point for a QR scan.
//
// This is the Cloudflare-native replacement for the Umami event in
// admin/lib/track.mjs. The redirect executor moved from the Pi's serve.mjs to
// the /q Pages Function, so the scan is recorded at the edge as it issues the
// 302. Mirrors track.mjs's discipline:
//   - Pure: builds a plain object; the caller does env.SCANS.writeDataPoint().
//   - Never throws into the caller; the caller fires-and-forgets.
//
// WAE shape (https://developers.cloudflare.com/analytics/analytics-engine/):
//   blobs   — up to 20 string dimensions, queryable as blob1..blob20
//   doubles — numeric metrics, double1..doubleN
//   indexes — exactly one sampling key, ≤96 bytes (we index by code id)
//
// Column map (keep in sync with admin/lib/stats.mjs):
//   blob1 = id          "<customerId>-<qid>", or "unknown" on a miss
//   blob2 = customerId
//   blob3 = qid
//   blob4 = type        external | internal | (empty on miss)
//   blob5 = hit         "hit" | "miss"
//   blob6 = env         local | staging | production
//   blob7 = version     build version/tag, best-effort
//   index1 = id

export function buildScanDataPoint({ id, customerId, qid, type, hit, env, version }) {
  return {
    blobs: [
      String(id ?? 'unknown'),
      String(customerId ?? ''),
      String(qid ?? ''),
      String(type ?? ''),
      hit ? 'hit' : 'miss',
      String(env ?? ''),
      String(version ?? ''),
    ],
    doubles: [1], // one scan; SUM(double1) == scan count, COUNT() also works
    indexes: [String(id ?? 'unknown').slice(0, 96)],
  };
}

// Fire one data point. Never throws — analytics must not break a redirect.
// `dataset` is the WAE binding (env.SCANS); absent in local dev → no-op.
export function recordScan(dataset, fields) {
  if (!dataset || typeof dataset.writeDataPoint !== 'function') return;
  try {
    dataset.writeDataPoint(buildScanDataPoint(fields));
  } catch {
    // swallow — a failed metric write must never affect the visitor
  }
}
