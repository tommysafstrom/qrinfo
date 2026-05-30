import Link from "next/link";
import { getCodes, getPages } from "@/lib/db";
import { resolveBaseUrl } from "@/lib/qr";

export const dynamic = "force-dynamic";

export default function AdminHome() {
  const codes = getCodes();
  const pages = getPages();
  const pageTitle = new Map(pages.map((p) => [p.id, p.title]));
  const base = resolveBaseUrl();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">QR-koder</h1>
        <Link
          href="/admin/codes/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
        >
          Ny kod
        </Link>
      </div>

      {codes.length === 0 ? (
        <p className="mt-8 text-gray-500">Inga koder ännu.</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
          {codes.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/codes/${c.id}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {c.label}
                  </Link>
                  {!c.enabled && (
                    <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                      avstängd
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-sm text-gray-500">
                  <span className="font-mono">{base}/q/{c.code}</span>
                  {" → "}
                  {c.type === "internal"
                    ? (pageTitle.get(c.target) ?? "(saknad sida)")
                    : c.target}
                </div>
              </div>
              <div className="shrink-0 text-right text-sm text-gray-400">
                {c.scanCount} skann
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
