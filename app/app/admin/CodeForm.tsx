"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Code, CodeType } from "@/lib/types";

interface PageOption {
  id: string;
  title: string;
  slug: string;
}

export default function CodeForm({
  mode,
  pages,
  initial,
}: {
  mode: "new" | "edit";
  pages: PageOption[];
  initial?: Code;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [type, setType] = useState<CodeType>(initial?.type ?? "internal");
  const [pageTarget, setPageTarget] = useState(
    initial?.type === "internal" ? initial.target : (pages[0]?.id ?? "")
  );
  const [urlTarget, setUrlTarget] = useState(
    initial?.type === "external" ? initial.target : ""
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const target = type === "internal" ? pageTarget : urlTarget.trim();
    const payload = { label: label.trim(), type, target, enabled };
    const res = await fetch(
      mode === "new" ? "/api/codes" : `/api/codes/${initial!.id}`,
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
    router.push("/admin");
    router.refresh();
  }

  async function remove() {
    if (!initial) return;
    if (!confirm("Ta bort den här koden?")) return;
    setBusy(true);
    const res = await fetch(`/api/codes/${initial.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.push("/admin");
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700">Etikett</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="t.ex. Plakett vid eken"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          required
        />
      </div>

      <div>
        <span className="block text-sm font-medium text-gray-700">Destination</span>
        <div className="mt-2 flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={type === "internal"}
              onChange={() => setType("internal")}
            />
            Intern infosida
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={type === "external"}
              onChange={() => setType("external")}
            />
            Extern URL
          </label>
        </div>
      </div>

      {type === "internal" ? (
        <div>
          <label className="block text-sm font-medium text-gray-700">Sida</label>
          {pages.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">
              Inga sidor ännu — skapa en under “Sidor” först.
            </p>
          ) : (
            <select
              value={pageTarget}
              onChange={(e) => setPageTarget(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700">URL</label>
          <input
            value={urlTarget}
            onChange={(e) => setUrlTarget(e.target.value)}
            placeholder="https://…"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
      )}

      {mode === "edit" && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Aktiv (avstängda koder visar ett felmeddelande vid skanning)
        </label>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || (type === "internal" && pages.length === 0)}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {mode === "new" ? "Skapa kod" : "Spara"}
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
