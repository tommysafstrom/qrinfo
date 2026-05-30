export const VALID_ID = /^[a-z0-9-]{1,64}$/;
export const VALID_PAGE_SLUG = /^[a-z0-9-]{1,64}$/;

export function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
