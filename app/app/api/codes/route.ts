import { NextRequest, NextResponse } from "next/server";
import { getCodes, addCode, getPage, generateUniqueCodeSlug, genId } from "@/lib/db";
import { isValidUrl, clampText } from "@/lib/validate";
import type { Code } from "@/lib/types";

export async function GET() {
  return NextResponse.json(getCodes());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Ogiltig data" }, { status: 400 });
  }

  const label = clampText(body.label, 200).trim();
  const type = body.type;
  const target = clampText(body.target, 2000).trim();

  if (!label) {
    return NextResponse.json({ error: "Etikett krävs" }, { status: 400 });
  }
  if (type !== "internal" && type !== "external") {
    return NextResponse.json({ error: "Ogiltig typ" }, { status: 400 });
  }
  if (type === "external" && !isValidUrl(target)) {
    return NextResponse.json({ error: "Ogiltig URL" }, { status: 400 });
  }
  if (type === "internal" && !getPage(target)) {
    return NextResponse.json({ error: "Sidan finns inte" }, { status: 400 });
  }

  const now = new Date().toISOString().slice(0, 10);
  const code: Code = {
    id: genId("c"),
    code: generateUniqueCodeSlug(),
    label,
    type,
    target,
    enabled: true,
    scanCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await addCode(code);
  return NextResponse.json(code, { status: 201 });
}
