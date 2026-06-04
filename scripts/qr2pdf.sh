#!/usr/bin/env bash
#
# qr2pdf.sh — scale QR-code SVGs to a fixed physical size and lay them out in a
# printable PDF: all codes are packed into a grid on as few pages as possible
# (each a square of --width cm). Self-contained: the Python implementation is
# embedded below, so this single file is all you need.
#
# Requires: python3 (standard library only — no pip packages).
#
# Usage:
#   ./qr2pdf.sh --width 4 --directory ./qr-examples -o codes.pdf
#   ./qr2pdf.sh --width 2.5 --images a.svg b.svg -o codes.pdf
#   ./qr2pdf.sh --width 3 --directory ./qr-examples --page Letter --gap 0.3
#
set -euo pipefail

# Pick a Python 3 interpreter.
if command -v python3 >/dev/null 2>&1; then
    PY=python3
elif command -v python >/dev/null 2>&1; then
    PY=python
else
    echo "qr2pdf: error: python3 is required but was not found on PATH" >&2
    exit 1
fi

# Run the embedded program, forwarding every argument unchanged.
# The heredoc delimiter is quoted ('PYEOF') so the shell does no expansion
# inside the Python source.
exec "$PY" - "$@" <<'PYEOF'
#!/usr/bin/env python3
"""Scale QR-code SVGs to a fixed physical size and lay them out in a printable PDF.

Each input image is rendered as a crisp vector square of exactly --width cm,
packed into a grid on as few pages as possible. Input SVGs are expected to be python-qrcode style:
a `viewBox`, a background `<path fill>`, and a black `<path stroke>` whose
`d` attribute is a sequence of horizontal module runs ("Mx y.5hN").

No third-party dependencies: SVG paths are translated straight into PDF
vector operators, so the result stays sharp at any print size.

Usage:
    qr_to_pdf.py --width 4 --directory ./qr-examples -o codes.pdf
    qr_to_pdf.py --width 2.5 --images a.svg b.svg -o codes.pdf
"""

from __future__ import annotations

import argparse
import re
import sys
import zlib
from pathlib import Path

# 1 cm = 72 / 2.54 PDF points (1 pt = 1/72 inch).
PT_PER_CM = 72.0 / 2.54


class SvgParseError(ValueError):
    """Raised when an SVG does not look like a supported QR SVG."""


def parse_qr_svg(text: str):
    """Return (viewbox_size, rects) for a python-qrcode style SVG.

    `viewbox_size` is the width of the (square) viewBox in user units.
    `rects` is a list of (x, y, w, h) black module rectangles in user units,
    using an SVG-style top-left origin with y growing downward.
    """
    vb = re.search(r'viewBox\s*=\s*"([^"]+)"', text)
    if not vb:
        raise SvgParseError("no viewBox found")
    parts = vb.group(1).replace(",", " ").split()
    if len(parts) != 4:
        raise SvgParseError(f"unexpected viewBox: {vb.group(1)!r}")
    _, _, vb_w, vb_h = (float(p) for p in parts)
    if vb_w != vb_h:
        raise SvgParseError(f"non-square viewBox {vb_w}x{vb_h}")

    # The black modules live in the <path stroke=...> element.
    stroke = re.search(r'<path[^>]*\bstroke=[^>]*\bd="([^"]+)"', text)
    if not stroke:
        raise SvgParseError("no stroke path found (is this a QR SVG?)")
    rects = parse_module_path(stroke.group(1))
    if not rects:
        raise SvgParseError("stroke path produced no modules")
    return vb_w, rects


def parse_module_path(d: str):
    """Parse a python-qrcode stroke path into unit-height module rectangles.

    The path is a series of absolute moves followed by horizontal runs:
        M2 2.5 h7   -> 7 modules starting at (2, 2), each 1x1
    Coordinates use a y+0.5 offset (stroke centered on a unit-high line),
    which we normalise back to integer top-left rectangles.
    """
    rects = []
    # Tokens: command letter or a (signed, decimal) number.
    tokens = re.findall(r"[MmHhVvLlZz]|-?\d*\.?\d+", d)
    i = 0
    cx = cy = 0.0
    while i < len(tokens):
        tok = tokens[i]
        if tok in ("M", "m"):
            x = float(tokens[i + 1])
            y = float(tokens[i + 2])
            cx = x if tok == "M" else cx + x
            cy = y if tok == "M" else cy + y
            i += 3
        elif tok in ("h", "H"):
            length = float(tokens[i + 1])
            start = cx if tok == "h" else 0.0
            run = length if tok == "h" else length - cx
            # cy is the stroke centre (y.5); top edge is cy - 0.5.
            rects.append((min(start, start + run), cy - 0.5, abs(run), 1.0))
            cx = start + run
            i += 2
        else:
            # Unsupported command for QR SVGs; skip its single arg if numeric.
            i += 1
    return rects


def draw_qr_ops(vb_size: float, rects, side_pt: float, ox: float, oy: float):
    """Yield PDF `re` rectangle ops for one QR placed with bottom-left at (ox, oy)."""
    scale = side_pt / vb_size
    for (x, y, w, h) in rects:
        # SVG y is top-down; PDF y is bottom-up. Flip within the QR square.
        px = ox + x * scale
        py = oy + (vb_size - y - h) * scale
        yield f"{px:.3f} {py:.3f} {w * scale:.3f} {h * scale:.3f} re"


def make_grid_page(items, slots, side_pt: float, gap: float,
                   page_w: float, page_h: float) -> bytes:
    """Build one content stream placing `items` into a centered grid of `slots`.

    `items` is a list of (vb_size, rects); `slots` is (cols, rows). The grid
    block is centered on the page; codes fill left-to-right, top-to-bottom.
    """
    cols, rows = slots
    block_w = cols * side_pt + (cols - 1) * gap
    block_h = rows * side_pt + (rows - 1) * gap
    left = (page_w - block_w) / 2.0
    top = (page_h - block_h) / 2.0  # top margin; rows go downward from here

    ops = ["0 0 0 rg"]  # black fill
    for idx, (vb_size, rects) in enumerate(items):
        col = idx % cols
        row = idx // cols
        ox = left + col * (side_pt + gap)
        # PDF origin is bottom-left, so the top row sits highest.
        oy = page_h - top - (row + 1) * side_pt - row * gap
        ops.extend(draw_qr_ops(vb_size, rects, side_pt, ox, oy))
    ops.append("f")
    return "\n".join(ops).encode("ascii")


def build_pdf(pages, page_w: float, page_h: float) -> bytes:
    """Assemble single-Page-per-image PDF. `pages` is a list of content streams."""
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)  # 1-based object number

    # Reserve catalog (1) and pages (2) numbers up front.
    catalog_num = 1
    pages_num = 2
    objects.append(b"")  # placeholder for catalog
    objects.append(b"")  # placeholder for pages

    kids = []
    for stream in pages:
        compressed = zlib.compress(stream)
        content_num = add(
            b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(compressed)
            + compressed
            + b"\nendstream"
        )
        page_num = add(
            b"<< /Type /Page /Parent %d 0 R "
            b"/MediaBox [0 0 %.3f %.3f] "
            b"/Contents %d 0 R /Resources << >> >>"
            % (pages_num, page_w, page_h, content_num)
        )
        kids.append(page_num)

    kids_str = " ".join(f"{n} 0 R" for n in kids).encode("ascii")
    objects[pages_num - 1] = (
        b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids_str, len(kids))
    )
    objects[catalog_num - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_num

    # Serialize with xref table.
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0] * (len(objects) + 1)
    for num, body in enumerate(objects, start=1):
        offsets[num] = len(out)
        out += b"%d 0 obj\n" % num + body + b"\nendobj\n"

    xref_pos = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for num in range(1, len(objects) + 1):
        out += b"%010d 00000 n \n" % offsets[num]
    out += (
        b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, catalog_num, xref_pos)
    )
    return bytes(out)


def collect_inputs(args) -> list[Path]:
    files: list[Path] = []
    if args.directory:
        d = Path(args.directory)
        if not d.is_dir():
            sys.exit(f"error: --directory {d} is not a directory")
        files.extend(sorted(d.glob("*.svg")))
    if args.images:
        for img in args.images:
            p = Path(img)
            if not p.is_file():
                sys.exit(f"error: --images {p} not found")
            files.append(p)
    if not files:
        sys.exit("error: no .svg inputs found (use --directory and/or --images)")
    return files


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Scale QR SVGs to a fixed cm size and lay them out in a printable PDF."
    )
    parser.add_argument("--directory", help="directory to scan for *.svg files")
    parser.add_argument("--images", nargs="+", help="explicit list of SVG files")
    parser.add_argument(
        "--width", type=float, required=True,
        help="side length of each (square) image, in centimeters",
    )
    parser.add_argument(
        "-o", "--output", default="qr-codes.pdf", help="output PDF path",
    )
    parser.add_argument(
        "--page", default="A4", choices=["A4", "Letter"],
        help="page size (default A4)",
    )
    parser.add_argument(
        "--gap", type=float, default=0.5,
        help="gap between codes, in centimeters (default 0.5)",
    )
    parser.add_argument(
        "--margin", type=float, default=1.0,
        help="minimum page margin, in centimeters (default 1.0)",
    )
    args = parser.parse_args(argv)

    if args.width <= 0:
        sys.exit("error: --width must be positive")
    if args.gap < 0 or args.margin < 0:
        sys.exit("error: --gap and --margin must not be negative")

    side_pt = args.width * PT_PER_CM
    gap_pt = args.gap * PT_PER_CM
    margin_pt = args.margin * PT_PER_CM
    page_w, page_h = (595.276, 841.890) if args.page == "A4" else (612.0, 792.0)

    # How many codes fit per row/column within the usable (margined) area.
    usable_w = page_w - 2 * margin_pt
    usable_h = page_h - 2 * margin_pt
    cols = int((usable_w + gap_pt) / (side_pt + gap_pt))
    rows = int((usable_h + gap_pt) / (side_pt + gap_pt))
    if cols < 1 or rows < 1:
        sys.exit(
            f"error: --width {args.width}cm does not fit on {args.page} "
            f"with a {args.margin}cm margin"
        )
    per_page = cols * rows

    files = collect_inputs(args)
    items = []
    for f in files:
        try:
            items.append(parse_qr_svg(f.read_text()))
        except SvgParseError as e:
            sys.exit(f"error: {f}: {e}")

    # Pack all codes into the grid; spill onto extra pages only if they overflow.
    streams = []
    for start in range(0, len(items), per_page):
        chunk = items[start:start + per_page]
        streams.append(
            make_grid_page(chunk, (cols, rows), side_pt, gap_pt, page_w, page_h)
        )

    pdf = build_pdf(streams, page_w, page_h)
    Path(args.output).write_bytes(pdf)
    n_pages = len(streams)
    page_word = "page" if n_pages == 1 else "pages"
    print(
        f"wrote {args.output}: {len(files)} image(s) at {args.width}cm "
        f"in a {cols}x{rows} grid on {n_pages} {page_word} ({args.page})"
    )


if __name__ == "__main__":
    main()
PYEOF
