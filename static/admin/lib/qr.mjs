// Admin preview/download wrappers around the shared badge composer, so the
// admin tool shows and downloads exactly what the build emits to dist/qr/
// (QR + "skannamig.com" caption on white).
import { badgePng, badgeSvg } from './badge.mjs';

export async function pngBuffer(url, { size = 512, idText } = {}) {
  return badgePng(url, { size, idText });
}

export async function svgString(url, { idText } = {}) {
  return badgeSvg(url, { idText });
}
