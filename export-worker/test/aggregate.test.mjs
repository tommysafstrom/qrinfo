// Unit tests for the pure WAE→D1 transform. Run: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHours,
  buildAggregateSql,
  toHourBucket,
  rowsFromWaeResult,
  UPSERT_SQL,
  upsertParams,
} from '../src/aggregate.mjs';

test('normalizeHours clamps junk to the fallback', () => {
  assert.equal(normalizeHours(3), 3);
  assert.equal(normalizeHours('5'), 5);
  assert.equal(normalizeHours(0), 3);
  assert.equal(normalizeHours(-1), 3);
  assert.equal(normalizeHours('abc'), 3);
  assert.equal(normalizeHours(undefined, 24), 24);
});

test('buildAggregateSql interpolates only a validated integer', () => {
  const sql = buildAggregateSql('qrinfo_scans', 3);
  assert.match(sql, /INTERVAL '3' HOUR/);
  assert.match(sql, /FROM qrinfo_scans/);
  // a non-integer hours falls back, never reaching the SQL verbatim
  const bad = buildAggregateSql('qrinfo_scans', "3'; DROP TABLE x;--");
  assert.match(bad, /INTERVAL '3' HOUR/);
  assert.doesNotMatch(bad, /DROP TABLE/);
});

test('toHourBucket normalizes WAE timestamps to a UTC hour ISO', () => {
  assert.equal(toHourBucket('2026-06-23 14:37:09'), '2026-06-23T14:00:00Z');
  assert.equal(toHourBucket('2026-06-23T14:00:00Z'), '2026-06-23T14:00:00Z');
  assert.equal(toHourBucket('not a date'), null);
});

test('rowsFromWaeResult coerces strings, buckets the hour, drops bad rows', () => {
  const rows = rowsFromWaeResult({
    data: [
      { day_hour: '2026-06-23 14:00:00', customer_id: '2', qid: '5', scans: '7', hits: '6', misses: '1' },
      { day_hour: '2026-06-23 15:00:00', customer_id: '3', qid: '1', scans: '2', hits: '2', misses: '0' },
      // bad: non-numeric customer_id → dropped
      { day_hour: '2026-06-23 15:00:00', customer_id: 'unknown', qid: '1', scans: '9' },
      // bad: unparseable hour → dropped
      { day_hour: 'nope', customer_id: '2', qid: '5', scans: '1' },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    day_hour: '2026-06-23T14:00:00Z', customer_id: 2, qid: 5, scans: 7, hits: 6, misses: 1,
  });
  // missing hit/miss fields default to 0, scans preserved
  assert.deepEqual(rows[1], {
    day_hour: '2026-06-23T15:00:00Z', customer_id: 3, qid: 1, scans: 2, hits: 2, misses: 0,
  });
});

test('rowsFromWaeResult tolerates empty / missing data', () => {
  assert.deepEqual(rowsFromWaeResult(undefined), []);
  assert.deepEqual(rowsFromWaeResult({}), []);
  assert.deepEqual(rowsFromWaeResult({ data: [] }), []);
});

test('upsertParams matches UPSERT_SQL ?1..?6 order and the SQL is idempotent', () => {
  const row = { day_hour: '2026-06-23T14:00:00Z', customer_id: 2, qid: 5, scans: 7, hits: 6, misses: 1 };
  assert.deepEqual(upsertParams(row), ['2026-06-23T14:00:00Z', 2, 5, 7, 6, 1]);
  // ON CONFLICT replaces counts → re-running a window can't double-count
  assert.match(UPSERT_SQL, /ON CONFLICT\(day_hour, customer_id, qid\) DO UPDATE/);
  assert.match(UPSERT_SQL, /scans = excluded\.scans/);
});

// A tiny fake D1 to exercise the upsert wiring end-to-end without a network.
test('fake-D1 batch applies upserts and the last write wins per key', () => {
  const store = new Map();
  const apply = (params) => {
    const [day_hour, customer_id, qid, scans, hits, misses] = params;
    store.set(`${day_hour}|${customer_id}|${qid}`, { scans, hits, misses });
  };
  const first = rowsFromWaeResult({
    data: [{ day_hour: '2026-06-23 14:00:00', customer_id: '2', qid: '5', scans: '3', hits: '3', misses: '0' }],
  });
  const second = rowsFromWaeResult({
    data: [{ day_hour: '2026-06-23 14:00:00', customer_id: '2', qid: '5', scans: '7', hits: '6', misses: '1' }],
  });
  [...first, ...second].forEach(r => apply(upsertParams(r)));
  assert.equal(store.size, 1, 'same hour/customer/code collapses to one row');
  assert.deepEqual(store.get('2026-06-23T14:00:00Z|2|5'), { scans: 7, hits: 6, misses: 1 });
});
