// Composes a QR "badge": the QR matrix plus two small gray caption lines at the
// bottom — the code's id ("<customerId>-<qid>") and "skannamig.com" — on a white
// background. Used by both the build (emits badge files to dist/qr/) and the
// admin preview endpoint, so the two always match.
//
// The id is intentionally generic: a code may be re-pointed to anything, so the
// printed label carries only the id, never the destination.
//
// The SVG is built by hand (dependency-free) from the raw QR module bitmap so we
// control the layout precisely. The PNG is just that same SVG rasterized with
// sharp, so both formats are pixel-for-pixel the same design.

import QRCode from 'qrcode';
import sharp from 'sharp';

const QUIET_ZONE = 4;        // modules of white border around the QR (spec min)
const CAPTION = 'skannamig.com';
const CAPTION_GRAY = '#888888'; // small gray used for both caption lines

// Layout, expressed in QR-module units so it scales with the code's version.
const CAPTION_GAP = 3;       // gap between QR bottom and the first caption line
const CAPTION_HEIGHT = 7;    // vertical space reserved per caption text line
const CAPTION_LINE_GAP = 1;  // gap between the id line and the domain line

export const BADGE_CAPTION = CAPTION;

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Build the rectangles for the dark QR modules as a single SVG path. Offsets put
// the QR inside the quiet zone.
function modulesToPath(data, size) {
  let d = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col]) {
        const x = col + QUIET_ZONE;
        const y = row + QUIET_ZONE;
        d += `M${x} ${y}h1v1h-1z`;
      }
    }
  }
  return d;
}

/**
 * Build the badge SVG string for a URL.
 * @param {string} url - the URL the QR encodes.
 * @param {object} [opts]
 * @param {string} [opts.bg='#ffffff'] - background fill.
 * @param {string} [opts.fg='#000000'] - QR fill (must contrast with bg).
 * @param {string} [opts.idText=''] - the code id line ("<customerId>-<qid>"); omitted when empty.
 * @returns {Promise<string>} SVG markup.
 */
export async function badgeSvg(url, { bg = '#ffffff', fg = '#000000', idText = '' } = {}) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const data = qr.modules.data;

  // Caption lines, top to bottom: the (optional) id, then the domain.
  const lines = [idText, CAPTION].filter(Boolean);

  // Total canvas in module units: QR + quiet zone on all sides, plus one band
  // per caption line (with a small gap between lines).
  const width = size + QUIET_ZONE * 2;
  const captionBand = lines.length === 0
    ? 0
    : CAPTION_GAP + lines.length * CAPTION_HEIGHT + (lines.length - 1) * CAPTION_LINE_GAP;
  const height = width + captionBand;

  const qrPath = modulesToPath(data, size);

  // Captions: centered, small gray, sized to sit comfortably in their band.
  const fontSize = CAPTION_HEIGHT * 0.39;
  const captionX = width / 2;
  const captionTexts = lines
    .map((text, i) => {
      const bandTop = size + QUIET_ZONE + CAPTION_GAP + i * (CAPTION_HEIGHT + CAPTION_LINE_GAP);
      const y = bandTop + CAPTION_HEIGHT * 0.72;
      return `<text x="${captionX}" y="${y}" text-anchor="middle" ` +
        `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" ` +
        `font-size="${fontSize}" font-weight="500" fill="${CAPTION_GRAY}" ` +
        `shape-rendering="auto">${escapeXml(text)}</text>`;
    })
    .join('');

  // The background rect and the QR path carry classes so the live page can
  // recolor both — dark backgrounds need a white foreground to stay scannable.
  // The captions stay gray (not recolored). Default fills stay black-on-white
  // for standalone files.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">` +
    `<rect class="badge-bg" width="${width}" height="${height}" fill="${bg}"/>` +
    `<path class="badge-fg" fill="${fg}" d="${qrPath}"/>` +
    captionTexts +
    `</svg>`;
}

/**
 * Rasterize the badge SVG to a PNG buffer.
 * @param {string} url - the URL the QR encodes.
 * @param {object} [opts]
 * @param {number} [opts.size=512] - target PNG width in px (height scales with the badge aspect).
 * @param {string} [opts.idText=''] - the code id line ("<customerId>-<qid>").
 * @returns {Promise<Buffer>}
 */
export async function badgePng(url, { size = 512, bg, fg, idText } = {}) {
  const svg = await badgeSvg(url, { bg, fg, idText });
  return sharp(Buffer.from(svg), { density: 384 })
    .resize({ width: size })
    .png()
    .toBuffer();
}
