import { NextRequest, NextResponse } from "next/server";
import { getCode } from "@/lib/db";
import { scanUrlFor, qrPng, qrSvg } from "@/lib/qr";
import { VALID_ID } from "@/lib/validate";

export async function GET(
  req: NextRequest,
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

  const format = req.nextUrl.searchParams.get("format") === "svg" ? "svg" : "png";
  const url = scanUrlFor(code.code);

  if (format === "svg") {
    const svg = await qrSvg(url);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="qr-${code.code}.svg"`,
      },
    });
  }

  const png = await qrPng(url);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="qr-${code.code}.png"`,
    },
  });
}
