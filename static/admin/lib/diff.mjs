import { codeId } from './schema.mjs';

const COMPARE_FIELDS = ['label', 'type', 'target', 'enabled'];

export function diffCodes(beforeDoc, afterDoc) {
  const beforeCodes = beforeDoc?.codes ?? [];
  const afterCodes = afterDoc?.codes ?? [];
  const before = new Map(beforeCodes.map(c => [codeId(c), c]));
  const after = new Map(afterCodes.map(c => [codeId(c), c]));

  const added = [];
  const removed = [];
  const modified = [];
  let unchanged = 0;

  for (const [id, code] of after) {
    if (!before.has(id)) {
      added.push(code);
      continue;
    }
    const old = before.get(id);
    const changes = COMPARE_FIELDS.filter(f => old[f] !== code[f]);
    if (changes.length === 0) {
      unchanged++;
    } else {
      modified.push({ id, before: old, after: code, changes });
    }
  }

  for (const [id, code] of before) {
    if (!after.has(id)) removed.push(code);
  }

  return { added, removed, modified, unchanged };
}
