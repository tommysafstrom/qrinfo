import { notFound } from "next/navigation";
import { getCode, getPages } from "@/lib/db";
import { scanUrlFor } from "@/lib/qr";
import CodeForm from "../../CodeForm";

export const dynamic = "force-dynamic";

export default async function EditCode({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const code = getCode(id);
  if (!code) notFound();

  const pages = getPages().map((p) => ({ id: p.id, title: p.title, slug: p.slug }));
  const scanUrl = scanUrlFor(code.code);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Redigera kod</h1>
      <p className="mt-1 font-mono text-sm text-gray-500">{scanUrl}</p>

      <div className="mt-6">
        <CodeForm mode="edit" pages={pages} initial={code} />
      </div>

      <section className="mt-10 rounded border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-800">QR-bild för plakett</h2>
        <p className="mt-1 text-sm text-gray-500">
          Skannar till <span className="font-mono">{scanUrl}</span>. Hög felkorrigering (nivå H).
        </p>
        <div className="mt-4 flex items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/codes/${code.id}/qr?format=png`}
            alt={`QR-kod för ${code.label}`}
            width={160}
            height={160}
            className="rounded border border-gray-200"
          />
          <div className="flex flex-col gap-2">
            <a
              href={`/api/codes/${code.id}/qr?format=png`}
              className="rounded bg-gray-800 px-4 py-2 text-center text-sm text-white"
            >
              Ladda ner PNG
            </a>
            <a
              href={`/api/codes/${code.id}/qr?format=svg`}
              className="rounded border border-gray-300 px-4 py-2 text-center text-sm text-gray-700"
            >
              Ladda ner SVG
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
