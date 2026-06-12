// Composes a QR "badge": the QR matrix plus a "skannamig.com" caption in black
// at the bottom, on a white background. Used by both the build (emits badge
// files to dist/qr/) and the admin preview endpoint, so the two always match.
//
// The SVG is built by hand (dependency-free) from the raw QR module bitmap so we
// control the layout precisely. The PNG is just that same SVG rasterized with
// sharp, so both formats are pixel-for-pixel the same design.

import QRCode from 'qrcode';
import sharp from 'sharp';

const QUIET_ZONE = 4;        // modules of white border around the QR (spec min)
const CAPTION = 'skannamig.com';

// Layout, expressed in QR-module units so it scales with the code's version.
const CAPTION_GAP = 3;       // gap between QR bottom and caption baseline area
const CAPTION_HEIGHT = 7;    // vertical space reserved for the caption text

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
 * @param {string} [opts.fg='#000000'] - QR + caption fill (must contrast with bg).
 * @returns {Promise<string>} SVG markup.
 */
export async function badgeSvg(url, { bg = '#ffffff', fg = '#000000' } = {}) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const data = qr.modules.data;

  // Total canvas in module units: QR + quiet zone on all sides, plus caption.
  const width = size + QUIET_ZONE * 2;
  const height = width + CAPTION_GAP + CAPTION_HEIGHT;

  const qrPath = modulesToPath(data, size);

  // Caption: centered, black, sized to sit comfortably in the reserved band.
  const captionY = size + QUIET_ZONE + CAPTION_GAP + CAPTION_HEIGHT * 0.72;
  const captionX = width / 2;
  const fontSize = CAPTION_HEIGHT * 0.78;

  // The background rect and the foreground (QR + caption) carry classes so the
  // live page can recolor both — dark backgrounds need a white foreground to
  // stay scannable. Default fills stay black-on-white for standalone files.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">` +
    `<rect class="badge-bg" width="${width}" height="${height}" fill="${bg}"/>` +
    `<path class="badge-fg" fill="${fg}" d="${qrPath}"/>` +
    `<text class="badge-fg" x="${captionX}" y="${captionY}" text-anchor="middle" ` +
    `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" ` +
    `font-size="${fontSize}" font-weight="600" fill="${fg}" ` +
    `shape-rendering="auto">${escapeXml(CAPTION)}</text>` +
    `</svg>`;
}

/**
 * Rasterize the badge SVG to a PNG buffer.
 * @param {string} url - the URL the QR encodes.
 * @param {object} [opts]
 * @param {number} [opts.size=512] - target PNG width in px (height scales with the badge aspect).
 * @returns {Promise<Buffer>}
 */
export async function badgePng(url, { size = 512, bg, fg } = {}) {
  const svg = await badgeSvg(url, { bg, fg });
  return sharp(Buffer.from(svg), { density: 384 })
    .resize({ width: size })
    .png()
    .toBuffer();
}
