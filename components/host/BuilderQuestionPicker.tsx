"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import QuestionUsageIndicator from "@/components/host/QuestionUsageIndicator";
import type { Database, QuestionMechanic } from "@/lib/supabase/database.types";
import { TRIVIA_DIFFICULTIES } from "@/lib/trivia/difficulty";
import {
  groupQuestionQuizUsage,
  questionQuizUsageRowsFromDatabase,
  type QuestionQuizUsage,
  type QuestionQuizUsageDatabaseRow,
} from "@/lib/trivia/question-usage";
import { sourceQuestionSearchOrFilter } from "@/lib/trivia/source-question-search";

export type PickerSourceQuestion = Database["public"]["Views"]["source_question_catalog"]["Row"];
type Category = Database["public"]["Tables"]["categories"]["Row"];
type Tag = Database["public"]["Tables"]["tags"]["Row"];
type TagAlias = Database["public"]["Tables"]["tag_aliases"]["Row"];

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
  const [usageByQuestion, setUsageByQuestion] = useState<Record<string, QuestionQuizUsage[]> | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagAliases, setTagAliases] = useState<TagAlias[]>([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<QuestionMechanic | "all">("all");
  const [categoryId, setCategoryId] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [tagId, setTagId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("tags").select("*").eq("is_active", true).order("name"),
      supabase.from("tag_aliases").select("*").order("alias"),
    ]).then(([categoryResult, tagResult, tagAliasResult]) => {
      if (!active) return;
      if (categoryResult.error || tagResult.error || tagAliasResult.error) {
        setError("Could not load question filters.");
        return;
      }
      setCategories(categoryResult.data ?? []);
      setTags(tagResult.data ?? []);
      setTagAliases(tagAliasResult.data ?? []);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      async function load() {
        setLoading(true);
        setError(null);
        setUsageByQuestion(null);
        let query = supabase
          .from("source_question_catalog")
          .select("*")
          .eq("origin", origin)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .range(0, 49);

        const searchFilter = sourceQuestionSearchOrFilter(search, categories, tags, tagAliases);
        if (searchFilter) query = query.or(searchFilter);
        if (type !== "all") query = query.eq("mechanic", type);
        if (categoryId) query = query.contains("category_ids", [categoryId]);
        if (difficulty) query = query.eq("editorial_difficulty", Number(difficulty));
        if (tagId) query = query.contains("tag_ids", [tagId]);

        const { data, error: queryError } = await query;
        if (!active) return;
        if (queryError) {
          setError("Could not load questions.");
          setQuestions([]);
        } else {
          const loadedQuestions = data ?? [];
          setQuestions(loadedQuestions);

          const sourceQuestionIds = loadedQuestions.map((question) => question.id);
          if (sourceQuestionIds.length === 0) {
            setUsageByQuestion({});
          } else {
            const usageResult = await supabase
              .from("quiz_questions")
              .select("source_question_id, quiz_id, quiz:quizzes!inner(title, updated_at)")
              .in("source_question_id", sourceQuestionIds);

            if (!active) return;
            if (usageResult.error) {
              console.error("Could not load question quiz usage:", usageResult.error);
              setUsageByQuestion(null);
            } else {
              const usageRows = questionQuizUsageRowsFromDatabase(
                (usageResult.data ?? []) as unknown as QuestionQuizUsageDatabaseRow[],
              );
              setUsageByQuestion(groupQuestionQuizUsage(usageRows));
            }
          }
        }
        setLoading(false);
      }
      void load();
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [origin, search, type, categoryId, difficulty, tagId, categories, tags, tagAliases]);

  const title = origin === "user" ? "My Questions" : "Question Library";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/45 px-4 py-8 backdrop-blur-sm">
      <section className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-zinc-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Add from {title}</h2>
            <p className="mt-1 text-sm text-zinc-500">The quiz receives an independent snapshot you can edit freely.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100">Close</button>
        </header>

        <div className="grid gap-3 border-b border-zinc-200 p-4 md:grid-cols-2 lg:grid-cols-6">
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search question, category, or topic…" className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 lg:col-span-2" />
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 outline-none focus:border-violet-500">
            <option value="">All categories</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 outline-none focus:border-violet-500">
            <option value="">All difficulties</option>
            {TRIVIA_DIFFICULTIES.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select>
          <select value={tagId} onChange={(event) => setTagId(event.target.value)} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 outline-none focus:border-violet-500">
            <option value="">All topics</option>
            {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
          <select value={type} onChange={(event) => setType(event.target.value as QuestionMechanic | "all")} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 outline-none focus:border-violet-500">
            <option value="all">All types</option>
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
                      {question.editorial_difficulty ? <span>· {TRIVIA_DIFFICULTIES[question.editorial_difficulty - 1]}</span> : null}
                      {question.is_verified ? <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">✓ Verified</span> : null}
                    </div>
                    <h3 className="text-sm font-bold leading-6 text-zinc-900">{question.prompt}</h3>
                    {question.tag_names.length > 0 ? <p className="mt-2 text-xs text-zinc-500">{question.tag_names.join(" · ")}</p> : null}
                    <QuestionUsageIndicator usages={usageByQuestion ? usageByQuestion[question.id] ?? [] : null} />
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
