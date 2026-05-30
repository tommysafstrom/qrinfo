import Link from "next/link";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-full">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <nav className="flex items-center gap-5">
            <Link href="/admin" className="text-lg font-semibold text-blue-700 hover:underline">
              QR Info
            </Link>
            <Link href="/admin" className="text-sm text-gray-600 hover:underline">
              Koder
            </Link>
            <Link href="/admin/pages" className="text-sm text-gray-600 hover:underline">
              Sidor
            </Link>
          </nav>
          <span className="text-xs text-amber-700 bg-amber-100 rounded px-2 py-1">
            Utveckling — ingen inloggning
          </span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
