import { NextRequest, NextResponse } from "next/server";
import { getCode, updateCode, deleteCode, getPage } from "@/lib/db";
import { isValidUrl, clampText, VALID_ID } from "@/lib/validate";
import type { Code } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!VALID_ID.test(id)) {
    return NextResponse.json({ error: "Ogiltigt ID" }, { status: 400 });
  }
  const code = getCode(id);
  if (!code) {
    return NextResponse.json({ error: "Koden hittades inte" }, { status: 404 });
  }
  return NextResponse.json(code);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!VALID_ID.test(id)) {
    return NextResponse.json({ error: "Ogiltigt ID" }, { status: 400 });
  }
  const existing = getCode(id);
  if (!existing) {
    return NextResponse.json({ error: "Koden hittades inte" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Ogiltig data" }, { status: 400 });
  }

  const next: Code = { ...existing };

  if (body.label !== undefined) {
    const label = clampText(body.label, 200).trim();
    if (!label) {
      return NextResponse.json({ error: "Etikett krävs" }, { status: 400 });
    }
    next.label = label;
  }
  if (body.type !== undefined) {
    if (body.type !== "internal" && body.type !== "external") {
      return NextResponse.json({ error: "Ogiltig typ" }, { status: 400 });
    }
    next.type = body.type;
  }
  if (body.target !== undefined) {
    next.target = clampText(body.target, 2000).trim();
  }
  if (body.enabled !== undefined) {
    next.enabled = Boolean(body.enabled);
  }

  // Validate the resulting type/target combination.
  if (next.type === "external" && !isValidUrl(next.target)) {
    return NextResponse.json({ error: "Ogiltig URL" }, { status: 400 });
  }
  if (next.type === "internal" && !getPage(next.target)) {
    return NextResponse.json({ error: "Sidan finns inte" }, { status: 400 });
  }

  next.updatedAt = new Date().toISOString().slice(0, 10);
  await updateCode(id, () => next);
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
  if (!getCode(id)) {
    return NextResponse.json({ error: "Koden hittades inte" }, { status: 404 });
  }
  await deleteCode(id);
  return NextResponse.json({ ok: true });
}
