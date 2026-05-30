import { notFound } from "next/navigation";
import { getPageBySlug } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InfoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = getPageBySlug(slug);
  if (!page) notFound();

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <article>
        <h1 className="text-3xl font-bold text-gray-900">{page.title}</h1>
        <div className="mt-6 text-lg leading-relaxed text-gray-700 whitespace-pre-wrap">
          {page.body}
        </div>
      </article>
    </main>
  );
}
