import { NextRequest, NextResponse } from "next/server";
import { getPages, addPage, getPageBySlug, genId } from "@/lib/db";
import { slugify, clampText, VALID_PAGE_SLUG } from "@/lib/validate";
import type { Page } from "@/lib/types";

export async function GET() {
  return NextResponse.json(getPages());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Ogiltig data" }, { status: 400 });
  }

  const title = clampText(body.title, 200).trim();
  const pageBody = clampText(body.body, 20000);
  if (!title) {
    return NextResponse.json({ error: "Titel krävs" }, { status: 400 });
  }

  let slug = body.slug ? slugify(clampText(body.slug, 64)) : slugify(title);
  if (!slug || !VALID_PAGE_SLUG.test(slug)) {
    return NextResponse.json({ error: "Ogiltig slug" }, { status: 400 });
  }
  // Ensure uniqueness by appending a counter.
  const base = slug;
  let n = 1;
  while (getPageBySlug(slug)) {
    slug = `${base}-${n++}`.slice(0, 64);
  }

  const page: Page = {
    id: genId("p"),
    slug,
    title,
    body: pageBody,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  await addPage(page);
  return NextResponse.json(page, { status: 201 });
}
