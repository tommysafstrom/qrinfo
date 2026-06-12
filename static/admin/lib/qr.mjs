// Admin preview/download wrappers around the shared badge composer, so the
// admin tool shows and downloads exactly what the build emits to dist/qr/
// (QR + "skannamig.com" caption on white).
import { badgePng, badgeSvg } from './badge.mjs';

export async function pngBuffer(url, { size = 512 } = {}) {
  return badgePng(url, { size });
}

export async function svgString(url) {
  return badgeSvg(url);
}
