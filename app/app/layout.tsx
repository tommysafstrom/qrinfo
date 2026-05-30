import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QR Info",
  description: "Registry and information pages for printed QR plaques",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv" className="h-full">
      <body className="min-h-full bg-gray-50 text-gray-900 font-sans">
        {children}
      </body>
    </html>
  );
}
