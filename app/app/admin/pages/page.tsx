import Link from "next/link";
import { getPages } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function PagesHome() {
  const pages = getPages();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Infosidor</h1>
        <Link
          href="/admin/pages/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
        >
          Ny sida
        </Link>
      </div>

      {pages.length === 0 ? (
        <p className="mt-8 text-gray-500">Inga sidor ännu.</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
          {pages.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <Link
                href={`/admin/pages/${p.id}`}
                className="font-medium text-blue-700 hover:underline"
              >
                {p.title}
              </Link>
              <Link
                href={`/info/${p.slug}`}
                className="shrink-0 font-mono text-sm text-gray-400 hover:underline"
              >
                /info/{p.slug}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
