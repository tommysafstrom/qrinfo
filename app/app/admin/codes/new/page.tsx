import { getPages } from "@/lib/db";
import CodeForm from "../../CodeForm";

export const dynamic = "force-dynamic";

export default function NewCode() {
  const pages = getPages().map((p) => ({ id: p.id, title: p.title, slug: p.slug }));
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Ny QR-kod</h1>
      <p className="mt-1 text-sm text-gray-500">
        En unik kod genereras automatiskt. QR-bilden laddar du ner efter att koden skapats.
      </p>
      <div className="mt-6">
        <CodeForm mode="new" pages={pages} />
      </div>
    </div>
  );
}
