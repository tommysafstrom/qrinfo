import QRCode from 'qrcode';

const DEFAULT_OPTIONS = { errorCorrectionLevel: 'H', margin: 2 };

export async function pngBuffer(url, { size, scale = 8 } = {}) {
  const opts = { ...DEFAULT_OPTIONS, type: 'png' };
  if (size) opts.width = size;
  else opts.scale = scale;
  return QRCode.toBuffer(url, opts);
}

export async function svgString(url, { scale = 8 } = {}) {
  return QRCode.toString(url, { ...DEFAULT_OPTIONS, type: 'svg', scale });
}
