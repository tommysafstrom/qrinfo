import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { releaseStateSchema } from './schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC = resolve(__dirname, '../..');
const FILE = resolve(STATIC, 'release-state.json');

export const STATE_FILE_REPO_PATH = 'static/release-state.json';

const DEFAULT_STATE = { version: 1, current: null, previous: [] };

export async function loadState() {
  if (!existsSync(FILE)) return structuredClone(DEFAULT_STATE);
  const text = await readFile(FILE, 'utf8');
  const raw = JSON.parse(text);
  return releaseStateSchema.parse(raw);
}

export async function saveState(state) {
  const validated = releaseStateSchema.parse(state);
  const json = JSON.stringify(validated, null, 2) + '\n';
  const tmp = `${FILE}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, json);
  await rename(tmp, FILE);
}
