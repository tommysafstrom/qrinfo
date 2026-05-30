import { redirect } from "next/navigation";
import { getCodeBySlug, getPage, bumpScanCount } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_CODE = /^[a-z0-9]{4,16}$/;

function Fallback({ message }: { message: string }) {
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-gray-800">QR-kod hittades inte</h1>
      <p className="mt-3 text-gray-600">{message}</p>
      <p className="mt-8 text-sm text-gray-400">QR Info</p>
    </main>
  );
}

export default async function Resolve({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  if (!VALID_CODE.test(code)) {
    return <Fallback message="Den här koden har ett ogiltigt format." />;
  }

  const entry = getCodeBySlug(code);
  if (!entry || !entry.enabled) {
    return (
      <Fallback message="Den här koden finns inte eller är avstängd just nu." />
    );
  }

  bumpScanCount(entry.id);

  if (entry.type === "external") {
    redirect(entry.target);
  }

  // internal
  const page = getPage(entry.target);
  if (!page) {
    return (
      <Fallback message="Sidan som den här koden pekar på saknas." />
    );
  }
  redirect(`/info/${page.slug}`);
}
