import { NextRequest, NextResponse } from "next/server";
import { getPage, updatePage, deletePage, getPageBySlug, isPageReferenced } from "@/lib/db";
import { slugify, clampText, VALID_PAGE_SLUG, VALID_ID } from "@/lib/validate";
import type { Page } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!VALID_ID.test(id)) {
    return NextResponse.json({ error: "Ogiltigt ID" }, { status: 400 });
  }
  const page = getPage(id);
  if (!page) {
    return NextResponse.json({ error: "Sidan hittades inte" }, { status: 404 });
  }
  return NextResponse.json(page);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!VALID_ID.test(id)) {
    return NextResponse.json({ error: "Ogiltigt ID" }, { status: 400 });
  }
  const existing = getPage(id);
  if (!existing) {
    return NextResponse.json({ error: "Sidan hittades inte" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Ogiltig data" }, { status: 400 });
  }

  const next: Page = { ...existing };

  if (body.title !== undefined) {
    const title = clampText(body.title, 200).trim();
    if (!title) {
      return NextResponse.json({ error: "Titel krävs" }, { status: 400 });
    }
    next.title = title;
  }
  if (body.body !== undefined) {
    next.body = clampText(body.body, 20000);
  }
  if (body.slug !== undefined) {
    const slug = slugify(clampText(body.slug, 64));
    if (!slug || !VALID_PAGE_SLUG.test(slug)) {
      return NextResponse.json({ error: "Ogiltig slug" }, { status: 400 });
    }
    const clash = getPageBySlug(slug);
    if (clash && clash.id !== id) {
      return NextResponse.json({ error: "Slug används redan" }, { status: 400 });
    }
    next.slug = slug;
  }

  next.updatedAt = new Date().toISOString().slice(0, 10);
  await updatePage(id, () => next);
  return NextResponse.json(next);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!VALID_ID.test(id)) {
    return NextResponse.json({ error: "Ogiltigt ID" }, { status: 400 });
  }
  if (!getPage(id)) {
    return NextResponse.json({ error: "Sidan hittades inte" }, { status: 404 });
  }
  if (isPageReferenced(id)) {
    return NextResponse.json(
      { error: "Sidan används av en QR-kod och kan inte tas bort" },
      { status: 409 }
    );
  }
  await deletePage(id);
  return NextResponse.json({ ok: true });
}
