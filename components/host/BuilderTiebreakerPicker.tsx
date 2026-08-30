"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type PickerSourceTiebreaker = Database["public"]["Tables"]["source_tiebreakers"]["Row"];

export default function BuilderTiebreakerPicker({
  onSelect,
  onClose,
}: {
  onSelect: (tiebreaker: PickerSourceTiebreaker) => void;
  onClose: () => void;
}) {
  const [tiebreakers, setTiebreakers] = useState<PickerSourceTiebreaker[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      let query = supabase
        .from("source_tiebreakers")
        .select("*")
        .eq("status", "active")
        .eq("is_verified", true)
        .order("updated_at", { ascending: false })
        .range(0, 99);

      const term = search.trim().replaceAll("%", "\\%").replaceAll(",", " ");
      if (term) query = query.or(`prompt.ilike.%${term}%,answer_unit.ilike.%${term}%`);

      const result = await query;
      if (!active) return;
      if (result.error) {
        console.error("Could not load tiebreaker library:", result.error);
        setError("Could not load tiebreakers.");
        setTiebreakers([]);
      } else {
        setTiebreakers(result.data ?? []);
      }
      setLoading(false);
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [search]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/45 px-4 py-8 backdrop-blur-sm">
      <section className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-zinc-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Choose from Tiebreaker Library</h2>
            <p className="mt-1 text-sm text-zinc-500">Pick a closest-answer question. You can cycle it later with Try another.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100">Close</button>
        </header>
        <div className="border-b border-zinc-200 p-4">
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} autoFocus
            placeholder="Search tiebreaker question or answer unit…"
            className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : loading ? (
            <p className="py-14 text-center text-sm text-zinc-500">Loading tiebreakers…</p>
          ) : tiebreakers.length === 0 ? (
            <p className="py-14 text-center text-sm text-zinc-500">No matching active tiebreakers.</p>
          ) : <div className="space-y-2">
            {tiebreakers.map(tiebreaker => <article key={tiebreaker.id} className="flex items-start gap-4 rounded-2xl border border-zinc-200 p-4 hover:border-violet-200">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-6 text-zinc-900">{tiebreaker.prompt}</p>
                <p className="mt-2 text-sm font-semibold text-emerald-700">Answer: {tiebreaker.correct_value.toLocaleString()}{tiebreaker.answer_unit ? ` ${tiebreaker.answer_unit}` : ""}</p>
                {tiebreaker.notes ? <p className="mt-1 text-xs leading-5 text-zinc-500">{tiebreaker.notes}</p> : null}
              </div>
              <button type="button" onClick={() => onSelect(tiebreaker)} className="shrink-0 cursor-pointer rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">Choose</button>
            </article>)}
          </div>}
        </div>
      </section>
    </div>
  );
}
