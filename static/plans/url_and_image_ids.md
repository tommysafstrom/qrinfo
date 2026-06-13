# Plan: customer-scoped QR URLs and id-based image/badge naming

## Goal (from original notes)

- Main QR URL becomes `www.skannamig.com/q/<customerId>/<qid>`.
- Codes are grouped under a customer id; each customer owns its own qids.
- Sample codes (tulip, sunflower, alleumgiganteum, humle) = **customer 1**.
- All taxon codes = **customer 2** (SLU).
- QR-badge image names become **ids only** (`<customerId>-<qid>`), generic — a code
  may be re-pointed to anything, so its name can't encode meaning.
- Badge prints `<customerId>-<qid>` in small gray text under the QR, and
  `skannamig.com` below it in the same small gray text.

## Decisions (confirmed with user)

- **Data model:** add `customerId` (int) + `qid` (int) to each code; drop `slug`.
  `target` stays (internal content still lives at `info/<target>.html`).
- **ID format:** numeric. URL `/q/1/3`, badge text `1-3`.
- **Customer split:** tulip/sunflower/alleumgiganteum/humle → customer 1; taxons → customer 2.
- **qid:** sequential per customer in current file order
  (c1: tulip=1, sunflower=2, alleumgiganteum=3, humle=4; c2: taxons 1..130).
- **Badge:** two small gray lines — `<customerId>-<qid>` then `skannamig.com`.
- **Image files:** `dist/qr/<customerId>-<qid>.png` / `.svg`.

## Identity

A code is now identified by the pair `(customerId, qid)`. Helper:
`codeId(c) = ` + "`${c.customerId}-${c.qid}`" + ` (used for filenames, badge text, diff keys, API params).

## Work items

1. **schema.mjs** — replace `slug` with `customerId` (int ≥ 1) + `qid` (int ≥ 1);
   uniqueness check on the `(customerId, qid)` pair; keep target refinement.
2. **codes.json** — migrate all 134 codes: drop `slug`, add `customerId`/`qid`
   per the split + sequential rule. Keep `label`, `type`, `target`, timestamps.
3. **badge.mjs** — add an `idText` caption line above `skannamig.com`; render both
   small + gray; default `idText` empty for standalone calls.
4. **build.mjs** —
   - `emitRedirects`: `/q/<cid>/<qid>` → `/scan.html?c=<cid>&q=<qid>`; fallback `/q/*`.
   - `emitQrs`: filenames `<cid>-<qid>.png/.svg`; pass URL + idText to badge.
   - `emitIndex`/`renderCard`: URL + badge idText.
   - `emitScanner` registry: emit `customerId`, `qid` (not slug).
5. **scan.js** — parse `/q/<cid>/<qid>` and `?c=&q=`; key registry by `cid-qid`;
   history keyed by id; thumbnails still use `target` (unchanged).
6. **scan.html** — no structural change expected (verify).
7. **codes.mjs / api.mjs** — CRUD + QR endpoint keyed by `customerId/qid` instead
   of slug; route patterns `/api/codes/:cid/:qid`, `/api/qr/:cid/:qid`.
8. **diff.mjs** — key by `cid-qid`.
9. **admin/public/app.js + index.html (admin)** — fields/URLs for customerId+qid.
10. **index.html (site) + not-found.html + README** — copy mentions of `/q/<namn>`.
11. Build locally (`--target local`) and sanity-check dist output.

## Out of scope

- Real per-customer auth / separate registries. Single codes.json keeps all customers.
- Renaming `info/<target>.html` content files (those stay; only the id layer changes).
