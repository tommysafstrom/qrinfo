#!/usr/bin/env python3
"""
Capture the "Taxon" frame from gardenexplorer.org pages and publish them as
internal info pages in the qrinfo static site so they show up when a QR code is
scanned.

The source site forbids iframe embedding (X-Frame-Options: SAMEORIGIN,
CSP frame-ancestors 'self'), so we can't embed their URLs directly. Instead we
extract ONLY the framed "Taxon" panel (botanical name, every image, the details
text + audio), host it on our own domain, and wire it into codes.json as an
internal code. scan.js then loads /info/<slug>.html in its iframe — same origin,
so it renders fine.

For each taxon it:
  * writes  static/info/<slug>.html        (the frame, self-contained)
  * writes  static/info/images/<slug>_*.*  (downloaded images + audio)
  * adds/updates an entry in static/codes.json:
        { slug, label: <botanical name>, type: "internal", target: <slug>, enabled }

slug = "taxon<id>"  (e.g. taxon19) — matches the qrinfo slug pattern.

Usage:
    python3 scrape_taxa.py 2624 11 19
    python3 scrape_taxa.py https://slukunskapsparken.gardenexplorer.org/taxon-19.aspx
    python3 scrape_taxa.py ids.txt                # one id/url per line
    python3 scrape_taxa.py --crawl                # every taxon that HAS images
    python3 scrape_taxa.py --crawl --limit 20     # first 20 (testing)
    python3 scrape_taxa.py --static /path/to/static 19   # override static/ dir

--crawl enumerates all taxa from the A–Z browse pages (taxalist-<L>.aspx),
fetches each detail page, and publishes ONLY those that have at least one image
(taxa with no image are skipped). --delay <sec> throttles between fetches
(default 0.3s). Explicit ids/files are always published, image or not.

After running, build/deploy the site as usual (npm run build).
No third-party Python dependencies.
"""

import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = "https://slukunskapsparken.gardenexplorer.org/"
UA = "Mozilla/5.0 (compatible; taxon-archiver/1.0)"

# qrinfo slug rule (schema.mjs SLUG_REGEX): ^[a-z0-9][a-z0-9-]{2,30}$
SLUG_REGEX = re.compile(r"^[a-z0-9][a-z0-9-]{2,30}$")

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STATIC = os.path.normpath(os.path.join(HERE, "..", "static"))


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def extract_element(html_text, element_id):
    """Return inner HTML of the element with the given id (handles nesting)."""
    start = html_text.find(f'id="{element_id}"')
    if start == -1:
        return None
    tag_open = html_text.rfind("<", 0, start)
    gt = html_text.find(">", start)
    if gt == -1:
        return None
    tag_name = re.match(r"<\s*([a-zA-Z0-9]+)", html_text[tag_open:gt + 1]).group(1)
    depth = 1
    pos = gt + 1
    inner_start = pos
    tag_re = re.compile(rf"<\s*(/?){re.escape(tag_name)}[\s>/]", re.IGNORECASE)
    while depth > 0:
        m = tag_re.search(html_text, pos)
        if not m:
            return html_text[inner_start:]
        if m.group(1) == "/":
            depth -= 1
            if depth == 0:
                return html_text[inner_start:m.start()]
        else:
            depth += 1
        pos = m.end()
    return html_text[inner_start:]


def absolutize(url):
    return urllib.parse.urljoin(BASE, url)


def parse_taxon(page_html, taxon_id):
    name_html = (extract_element(
        page_html, "ctl00_ContentPlaceHolder1_TaxaDetail1_TaxonName") or "").strip()
    name_text = re.sub(r"<[^>]+>", "", name_html).strip()

    images = []
    m = re.search(
        r'id="ctl00_ContentPlaceHolder1_TaxaDetail1_ImageFinder1_ImageArray"[^>]*\svalue="([^"]*)"',
        page_html,
    )
    if m and m.group(1).strip():
        images = [absolutize(u) for u in m.group(1).split(",") if u.strip()]
    if not images:
        m = re.search(
            r'id="ctl00_ContentPlaceHolder1_TaxaDetail1_ImageFinder1_Repeater1_ctl00_TaxonImage"[^>]*\ssrc="([^"]+)"',
            page_html,
        )
        if m and "noimage" not in m.group(1).lower():
            images = [absolutize(m.group(1))]

    details_html = (extract_element(
        page_html, "ctl00_ContentPlaceHolder1_TaxaDetail1_TaxonDetails") or "").strip()

    return {
        "id": taxon_id,
        "name_html": name_html,
        "name_text": name_text or f"taxon-{taxon_id}",
        "images": images,
        "details_html": details_html,
    }


def rewrite_details(details_html, local_media):
    """Make links absolute, and point audio/media srcs at local copies."""
    def repl_src(m):
        attr, url = m.group(1), m.group(3)
        absu = absolutize(url)
        local = local_media.get(absu)
        return f'{attr}="{local or absu}"'

    details_html = re.sub(r"""(src)=(['"])([^'"]+)\2""", repl_src, details_html)

    def repl_href(m):
        url = m.group(2)
        if not url or url.startswith("javascript:") or url.startswith("#"):
            return m.group(0)
        return f'href="{absolutize(url)}" target="_blank" rel="noopener noreferrer"'

    details_html = re.sub(r"""href=(['"])([^'"]*)\1""", repl_href, details_html)
    return details_html


PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{style}</style>
</head>
<body>
<main class="taxon-card">
  <div class="taxon-header">Taxon</div>
  <h1 class="taxon-name">{name_html}</h1>
  <hr>
  <div class="taxon-body">
    <div class="taxon-images">
{images_html}
    </div>
    <div class="taxon-text">
{details_html}
    </div>
  </div>
</main>
</body>
</html>
"""

# Inlined so each info page is fully self-contained (no shared asset to manage).
STYLE = """*{box-sizing:border-box}
body{font-family:Roboto,Arial,sans-serif;background:#fff;margin:0;padding:0;color:#222}
.taxon-card{max-width:960px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:4px;overflow:hidden}
.taxon-header{background:#0c6b6b;color:#fff;padding:8px 16px;font-size:18px}
.taxon-name{font-size:22px;padding:12px 16px 0;margin:0;font-weight:400}
.taxon-name i{font-style:italic}
.taxon-card hr{border:none;border-top:1px solid #e0e0e0;margin:12px 0 0}
.taxon-body{display:flex;flex-wrap:wrap;gap:16px;padding:16px}
.taxon-text{flex:1 1 320px;min-width:280px;line-height:1.5}
.taxon-images{flex:1 1 360px;min-width:280px;display:flex;flex-direction:column;gap:10px}
.taxon-images img{width:100%;height:auto;border:1px solid #ccc;border-radius:3px;display:block}
.taxoninfo{margin:2px 0}
.taxon-text strong,.taxon-text b{color:#000}
.taxon-text a{color:#0c6b6b}
audio{width:100%;margin-top:6px}
.noimg{color:#999}
"""


def build_page(taxon, img_rel):
    imgs = "\n".join(
        f'      <a href="{f}" target="_blank"><img src="{f}" '
        f'alt="{html.escape(taxon["name_text"])}" loading="lazy"></a>'
        for f in img_rel
    ) or "      <p class='noimg'>(ingen bild)</p>"
    return PAGE_TEMPLATE.format(
        title=html.escape(taxon["name_text"]),
        style=STYLE,
        name_html=taxon["name_html"],
        images_html=imgs,
        details_html=taxon["details_html"],
    )


def download(url, dest_dir, fname):
    path = os.path.join(dest_dir, fname)
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    return fname


def normalize_id(token):
    token = token.strip()
    if not token:
        return None
    m = re.search(r"taxon[-.=]?t?=?(\d+)", token) or re.search(r"(\d+)", token)
    return m.group(1) if m else None


def upsert_code(codes_path, slug, label, target):
    """Add or update an internal code entry in codes.json (idempotent)."""
    with open(codes_path) as f:
        doc = json.load(f)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    for c in doc.get("codes", []):
        if c.get("slug") == slug:
            c["label"] = label
            c["type"] = "internal"
            c["target"] = target
            c["enabled"] = True
            c["updatedAt"] = now
            break
    else:
        doc.setdefault("codes", []).append({
            "slug": slug,
            "label": label,
            "type": "internal",
            "target": target,
            "enabled": True,
            "createdAt": now,
            "updatedAt": now,
        })
    with open(codes_path, "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def crawl_ids():
    """Enumerate every taxon id from the A–Z browse pages (deduped, in order)."""
    seen = set()
    ids = []
    for letter in LETTERS:
        url = f"{BASE}taxalist-{letter}.aspx"
        try:
            page = fetch(url)
        except Exception as e:
            print(f"    ! crawl {url} failed: {e}")
            continue
        found = re.findall(r"taxon-(\d+)\.aspx", page)
        new = 0
        for tid in found:
            if tid not in seen:
                seen.add(tid)
                ids.append(tid)
                new += 1
        print(f"  {letter}: {new} taxa")
    print(f"  total: {len(ids)} unique taxa to check")
    return ids


def process_taxon(tid, info_dir, img_dir, codes_path, skip_no_image=False):
    """Fetch, parse and publish one taxon. Returns True if published."""
    slug = f"taxon{tid}"
    if not SLUG_REGEX.match(slug):
        print(f"[{tid}] slug '{slug}' invalid for qrinfo — skipping")
        return False
    url = f"{BASE}taxon-{tid}.aspx"
    try:
        page = fetch(url)
    except Exception as e:
        print(f"[{tid}] ! fetch failed: {e}")
        return False
    taxon = parse_taxon(page, tid)

    if skip_no_image and not taxon["images"]:
        print(f"[{tid}] {taxon['name_text']}  (no image — skipped)")
        return False

    print(f"[{tid}] {taxon['name_text']}  ({len(taxon['images'])} image(s))")

    img_rel = []
    for idx, iu in enumerate(taxon["images"], 1):
        ext = os.path.splitext(urllib.parse.urlparse(iu).path)[1] or ".jpg"
        try:
            fname = download(iu, img_dir, f"{slug}_{idx}{ext}")
            img_rel.append(f"images/{fname}")
        except Exception as e:
            print(f"    ! image {iu} failed: {e}")

    local_media = {}
    for mu in re.findall(
        r"""src=['"]([^'"]+\.(?:mp3|mp4|ogg|wav|webm|m4a))['"]""",
        taxon["details_html"], re.I,
    ):
        absu = absolutize(mu)
        name = os.path.basename(urllib.parse.urlparse(absu).path)
        try:
            fname = download(absu, img_dir, f"{slug}_{name}")
            local_media[absu] = f"images/{fname}"
        except Exception as e:
            print(f"    ! media {absu} failed: {e}")
    taxon["details_html"] = rewrite_details(taxon["details_html"], local_media)

    page_html = build_page(taxon, img_rel)
    with open(os.path.join(info_dir, f"{slug}.html"), "w") as f:
        f.write(page_html)

    upsert_code(codes_path, slug, taxon["name_text"], slug)
    print(f"    -> info/{slug}.html  ·  code '{slug}' upserted")
    return True


def main(argv):
    static_dir = DEFAULT_STATIC
    crawl = False
    limit = None
    delay = 0.3
    args = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--static", "-s"):
            static_dir = argv[i + 1]
            i += 2
        elif a == "--crawl":
            crawl = True
            i += 1
        elif a == "--limit":
            limit = int(argv[i + 1])
            i += 2
        elif a == "--delay":
            delay = float(argv[i + 1])
            i += 2
        else:
            args.append(a)
            i += 1

    info_dir = os.path.join(static_dir, "info")
    img_dir = os.path.join(info_dir, "images")
    codes_path = os.path.join(static_dir, "codes.json")
    if not os.path.isfile(codes_path):
        print(f"codes.json not found at {codes_path} — is --static correct?")
        return 1
    os.makedirs(img_dir, exist_ok=True)

    if crawl:
        print("Crawling A–Z browse pages for taxon ids…")
        ids = crawl_ids()
        skip_no_image = True   # --crawl publishes only taxa that have images
    else:
        ids = []
        for a in args:
            if os.path.isfile(a):
                with open(a) as f:
                    for line in f:
                        nid = normalize_id(line)
                        if nid:
                            ids.append(nid)
            else:
                nid = normalize_id(a)
                if nid:
                    ids.append(nid)
        skip_no_image = False  # explicit ids are published regardless

    if not ids:
        print("Nothing to do. Pass taxon ids, a file, or --crawl.")
        return 1

    if limit is not None:
        ids = ids[:limit]

    published = 0
    skipped = 0
    for n, tid in enumerate(ids):
        if process_taxon(tid, info_dir, img_dir, codes_path, skip_no_image):
            published += 1
        else:
            skipped += 1
        # be polite between detail-page fetches when doing many
        if delay and n + 1 < len(ids):
            time.sleep(delay)

    print(f"\nDone. {published} published · {skipped} skipped.")
    print("Now build & deploy the site (e.g. `npm run build`).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
