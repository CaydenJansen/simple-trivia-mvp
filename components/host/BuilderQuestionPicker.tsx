"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import type { Database, QuestionMechanic } from "@/lib/supabase/database.types";

export type PickerSourceQuestion = Database["public"]["Views"]["source_question_catalog"]["Row"];

export default function BuilderQuestionPicker({
  origin,
  onSelect,
  onClose,
}: {
  origin: "user" | "platform";
  onSelect: (question: PickerSourceQuestion) => void;
  onClose: () => void;
}) {
  const [questions, setQuestions] = useState<PickerSourceQuestion[]>([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<QuestionMechanic | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      async function load() {
        setLoading(true);
        setError(null);
        let query = supabase
          .from("source_question_catalog")
          .select("*")
          .eq("origin", origin)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .range(0, 49);

        if (search.trim()) query = query.ilike("prompt", `%${search.trim()}%`);
        if (type !== "all") query = query.eq("mechanic", type);

        const { data, error: queryError } = await query;
        if (!active) return;
        setLoading(false);
        if (queryError) {
          setError("Could not load questions.");
          setQuestions([]);
        } else {
          setQuestions(data ?? []);
        }
      }
      void load();
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [origin, search, type]);

  const title = origin === "user" ? "My Questions" : "Question Library";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/45 px-4 py-8 backdrop-blur-sm">
      <section className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-zinc-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Add from {title}</h2>
            <p className="mt-1 text-sm text-zinc-500">The quiz receives an independent snapshot you can edit freely.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100">Close</button>
        </header>

        <div className="grid gap-3 border-b border-zinc-200 p-4 sm:grid-cols-[1fr_190px]">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
          <select value={type} onChange={(event) => setType(event.target.value as QuestionMechanic | "all")} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 outline-none focus:border-violet-500">
            <option value="all">All question types</option>
            <option value="single-answer">Single Answer</option>
            <option value="multiple-choice">Multiple Choice</option>
            <option value="multi-answer">Multi-Answer</option>
            <option value="multi-part">Multi-Part</option>
            <option value="ranking">Ranking</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : loading ? (
            <p className="py-16 text-center text-sm text-zinc-500">Loading questions…</p>
          ) : questions.length === 0 ? (
            <div className="py-16 text-center"><h3 className="font-bold text-zinc-900">No matching questions</h3><p className="mt-2 text-sm text-zinc-500">{origin === "user" ? "Create questions from the Questions area or choose Write New." : "The Question Library does not have matching active content yet."}</p></div>
          ) : (
            <div className="space-y-2">
              {questions.map((question) => (
                <article key={question.id} className="flex items-start gap-4 rounded-2xl border border-zinc-200 p-4 hover:border-violet-200">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="rounded-full bg-violet-50 px-2 py-1 font-semibold text-violet-700">{question.question_type.replaceAll("-", " ")}</span>
                      {question.category_names.length > 0 ? <span>{question.category_names.join(" · ")}</span> : null}
                      {question.editorial_difficulty ? <span>· Difficulty {question.editorial_difficulty}/5</span> : null}
                      {question.is_verified ? <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">✓ Verified</span> : null}
                    </div>
                    <h3 className="text-sm font-bold leading-6 text-zinc-900">{question.prompt}</h3>
                    {question.tag_names.length > 0 ? <p className="mt-2 text-xs text-zinc-500">{question.tag_names.join(" · ")}</p> : null}
                  </div>
                  <button type="button" onClick={() => onSelect(question)} className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">Add</button>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
