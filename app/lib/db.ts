import fs from "fs";
import path from "path";
import type { DB, Code, Page } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "db.json");

// Simple write-lock via a module-level promise chain
let writeChain: Promise<void> = Promise.resolve();

export function readDB(): DB {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  return {
    codes: parsed.codes ?? [],
    pages: parsed.pages ?? [],
  } as DB;
}

export function writeDB(db: DB): Promise<void> {
  writeChain = writeChain.then(
    () =>
      new Promise<void>((resolve, reject) => {
        try {
          fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
          resolve();
        } catch (err) {
          reject(err);
        }
      })
  );
  return writeChain;
}

function randomSlug(len: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// --- Code helpers ---

export function getCodes(): Code[] {
  return readDB().codes;
}

export function getCode(id: string): Code | undefined {
  return readDB().codes.find((c) => c.id === id);
}

export function getCodeBySlug(code: string): Code | undefined {
  return readDB().codes.find((c) => c.code === code);
}

export function generateUniqueCodeSlug(): string {
  const existing = new Set(readDB().codes.map((c) => c.code));
  let slug = randomSlug(6);
  while (existing.has(slug)) slug = randomSlug(6);
  return slug;
}

export function addCode(code: Code): Promise<void> {
  const db = readDB();
  db.codes.push(code);
  return writeDB(db);
}

export function updateCode(id: string, updater: (code: Code) => Code): Promise<void> {
  const db = readDB();
  const idx = db.codes.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`Code ${id} not found`);
  db.codes[idx] = updater(db.codes[idx]);
  return writeDB(db);
}

export function deleteCode(id: string): Promise<void> {
  const db = readDB();
  db.codes = db.codes.filter((c) => c.id !== id);
  return writeDB(db);
}

// Fire-and-forget scan counter bump. Never throw into the resolve path.
export function bumpScanCount(id: string): void {
  try {
    const db = readDB();
    const idx = db.codes.findIndex((c) => c.id === id);
    if (idx === -1) return;
    db.codes[idx] = { ...db.codes[idx], scanCount: db.codes[idx].scanCount + 1 };
    void writeDB(db);
  } catch {
    // counting is best-effort; a failure must not block the redirect
  }
}

// --- Page helpers ---

export function getPages(): Page[] {
  return readDB().pages;
}

export function getPage(id: string): Page | undefined {
  return readDB().pages.find((p) => p.id === id);
}

export function getPageBySlug(slug: string): Page | undefined {
  return readDB().pages.find((p) => p.slug === slug);
}

export function addPage(page: Page): Promise<void> {
  const db = readDB();
  db.pages.push(page);
  return writeDB(db);
}

export function updatePage(id: string, updater: (page: Page) => Page): Promise<void> {
  const db = readDB();
  const idx = db.pages.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Page ${id} not found`);
  db.pages[idx] = updater(db.pages[idx]);
  return writeDB(db);
}

export function deletePage(id: string): Promise<void> {
  const db = readDB();
  db.pages = db.pages.filter((p) => p.id !== id);
  return writeDB(db);
}

export function isPageReferenced(pageId: string): boolean {
  return readDB().codes.some((c) => c.type === "internal" && c.target === pageId);
}

export function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${randomSlug(3)}`;
}
