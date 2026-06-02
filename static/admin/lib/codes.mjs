import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { codesJsonSchema, codeInputSchema, codePatchSchema } from './schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const FILE = resolve(ROOT, 'codes.json');

export async function loadCodes() {
  const text = await readFile(FILE, 'utf8');
  const raw = JSON.parse(text);
  return codesJsonSchema.parse(raw);
}

export async function saveCodes(doc) {
  const validated = codesJsonSchema.parse(doc);
  const json = JSON.stringify(validated, null, 2) + '\n';
  const tmp = `${FILE}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, json);
  await rename(tmp, FILE);
}

export function nowIso() {
  return new Date().toISOString();
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export async function addCode(input) {
  const parsed = codeInputSchema.parse(input);
  const doc = await loadCodes();
  if (doc.codes.some(c => c.slug === parsed.slug)) {
    throw httpError(409, `slug "${parsed.slug}" already exists`);
  }
  const now = nowIso();
  const created = { ...parsed, createdAt: now, updatedAt: now };
  doc.codes.push(created);
  await saveCodes(doc);
  return created;
}

export async function replaceCode(slug, input) {
  const parsed = codeInputSchema.parse(input);
  if (parsed.slug !== slug) {
    throw httpError(400, `body slug "${parsed.slug}" does not match url slug "${slug}"`);
  }
  const doc = await loadCodes();
  const i = doc.codes.findIndex(c => c.slug === slug);
  if (i < 0) throw httpError(404, `code "${slug}" not found`);
  const updated = { ...parsed, createdAt: doc.codes[i].createdAt, updatedAt: nowIso() };
  doc.codes[i] = updated;
  await saveCodes(doc);
  return updated;
}

export async function patchCode(slug, patch) {
  const parsed = codePatchSchema.parse(patch);
  const doc = await loadCodes();
  const i = doc.codes.findIndex(c => c.slug === slug);
  if (i < 0) throw httpError(404, `code "${slug}" not found`);
  const updated = { ...doc.codes[i], ...parsed, slug, updatedAt: nowIso() };
  doc.codes[i] = updated;
  await saveCodes(doc);
  return updated;
}

export async function deleteCode(slug) {
  const doc = await loadCodes();
  const before = doc.codes.length;
  doc.codes = doc.codes.filter(c => c.slug !== slug);
  if (doc.codes.length === before) throw httpError(404, `code "${slug}" not found`);
  await saveCodes(doc);
  return { slug, deleted: true };
}
