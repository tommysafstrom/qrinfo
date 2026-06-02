const COMPARE_FIELDS = ['label', 'type', 'target', 'enabled'];

export function diffCodes(beforeDoc, afterDoc) {
  const beforeCodes = beforeDoc?.codes ?? [];
  const afterCodes = afterDoc?.codes ?? [];
  const before = new Map(beforeCodes.map(c => [c.slug, c]));
  const after = new Map(afterCodes.map(c => [c.slug, c]));

  const added = [];
  const removed = [];
  const modified = [];
  let unchanged = 0;

  for (const [slug, code] of after) {
    if (!before.has(slug)) {
      added.push(code);
      continue;
    }
    const old = before.get(slug);
    const changes = COMPARE_FIELDS.filter(f => old[f] !== code[f]);
    if (changes.length === 0) {
      unchanged++;
    } else {
      modified.push({ slug, before: old, after: code, changes });
    }
  }

  for (const [slug, code] of before) {
    if (!after.has(slug)) removed.push(code);
  }

  return { added, removed, modified, unchanged };
}
