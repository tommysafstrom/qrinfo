"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Page } from "@/lib/types";

export default function PageForm({
  mode,
  initial,
}: {
  mode: "new" | "edit";
  initial?: Page;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const payload: Record<string, string> = { title: title.trim(), body };
    if (slug.trim()) payload.slug = slug.trim();
    const res = await fetch(
      mode === "new" ? "/api/pages" : `/api/pages/${initial!.id}`,
      {
        method: mode === "new" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Något gick fel");
      return;
    }
    router.push("/admin/pages");
    router.refresh();
  }

  async function remove() {
    if (!initial) return;
    if (!confirm("Ta bort den här sidan?")) return;
    setBusy(true);
    const res = await fetch(`/api/pages/${initial.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Kunde inte ta bort");
      return;
    }
    router.push("/admin/pages");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700">Titel</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Slug {mode === "new" && <span className="text-gray-400">(valfritt — skapas från titeln)</span>}
        </label>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="t.ex. eken"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Innehåll</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-sans"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {mode === "new" ? "Skapa sida" : "Spara"}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded border border-red-300 px-4 py-2 text-red-700 disabled:opacity-50"
          >
            Ta bort
          </button>
        )}
      </div>
    </form>
  );
}
