import { notFound } from "next/navigation";
import Link from "next/link";
import { getPage } from "@/lib/db";
import PageForm from "../../PageForm";

export const dynamic = "force-dynamic";

export default async function EditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const page = getPage(id);
  if (!page) notFound();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Redigera sida</h1>
        <Link
          href={`/info/${page.slug}`}
          className="text-sm text-blue-700 hover:underline"
        >
          Visa publik sida
        </Link>
      </div>
      <div className="mt-6">
        <PageForm mode="edit" initial={page} />
      </div>
    </div>
  );
}
