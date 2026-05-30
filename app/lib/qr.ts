import QRCode from "qrcode";

export function resolveBaseUrl(): string {
  return (process.env.QR_BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

export function scanUrlFor(code: string): string {
  return `${resolveBaseUrl()}/q/${code}`;
}

const OPTS = {
  // High error correction survives wear/dirt on a printed plaque.
  errorCorrectionLevel: "H" as const,
  margin: 2,
};

export function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { ...OPTS, type: "png", width: 600 });
}

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { ...OPTS, type: "svg" });
}
