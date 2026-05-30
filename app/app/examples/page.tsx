import { getCode } from "@/lib/db";
import { scanUrlFor } from "@/lib/qr";
import type { Code } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXAMPLE_IDS = ["c-flower-tulip", "c-flower-sunflower"];

export default function Examples() {
  const codes = EXAMPLE_IDS.map((id) => getCode(id)).filter(
    (c): c is Code => Boolean(c)
  );

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900">Exempel: blomster-QR</h1>
      <p className="mt-2 text-gray-600">
        Skanna en kod med telefonen så öppnas blommans Wikipedia-sida.
      </p>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        {codes.map((c) => (
          <figure
            key={c.id}
            className="flex flex-col items-center rounded-lg border border-gray-200 bg-white p-5 text-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/codes/${c.id}/qr?format=png`}
              alt={`QR-kod för ${c.label}`}
              width={240}
              height={240}
              className="rounded border border-gray-200"
            />
            <figcaption className="mt-4">
              <div className="font-semibold text-gray-900">{c.label}</div>
              <a
                href={c.target}
                className="mt-1 block break-all text-sm text-blue-700 hover:underline"
              >
                {c.target}
              </a>
              <div className="mt-1 font-mono text-xs text-gray-400">
                {scanUrlFor(c.code)}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
