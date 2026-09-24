"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import BrandWordmark from "@/components/BrandWordmark";
import { supabase } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";

type SupplyRow = { difficulty?: number | null; question_type?: string; category_name?: string; question_count: number };
type UsedQuestion = {
  id: string;
  prompt: string;
  editorial_difficulty: number | null;
  observed_difficulty: number | null;
  uses: number;
  correct_percent: number;
};
type DashboardData = {
  games_total: number;
  games_last_30_days: number;
  games_last_7_days: number;
  games_live: number;
  unique_hosts: number;
  teams_total: number;
  answers_total: number;
  library_active: number;
  library_never_played: number;
  suggestions_pending: number;
  questions_observed: number;
  questions_adapted: number;
  most_used: UsedQuestion[];
  supply_by_difficulty: SupplyRow[];
  supply_by_mechanic: SupplyRow[];
  supply_by_category: SupplyRow[];
};
type Suggestion = {
  suggestion_id: string;
  question_id: string;
  question_prompt: string;
  question_type: string;
  current_answer: Json;
  answer_slot: number;
  proposed_answer: string;
  expected_answer: string | null;
  distinct_host_count: number;
  signal_count: number;
  status: "collecting" | "pending";
  created_at: string;
};

const DIFFICULTIES = ["Very Easy", "Easy", "Medium", "Hard", "Very Hard"];

type JsonRecord = { [key: string]: Json | undefined };

function asRecord(value: Json | null): JsonRecord {
  return value && !Array.isArray(value) && typeof value === "object" ? value : {};
}

function numberValue(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function arrayValue<T>(record: JsonRecord, key: string) {
  return Array.isArray(record[key]) ? record[key] as unknown as T[] : [];
}

function parseDashboard(value: Json | null): DashboardData {
  const record = asRecord(value);
  return {
    games_total: numberValue(record, "games_total"),
    games_last_30_days: numberValue(record, "games_last_30_days"),
    games_last_7_days: numberValue(record, "games_last_7_days"),
    games_live: numberValue(record, "games_live"),
    unique_hosts: numberValue(record, "unique_hosts"),
    teams_total: numberValue(record, "teams_total"),
    answers_total: numberValue(record, "answers_total"),
    library_active: numberValue(record, "library_active"),
    library_never_played: numberValue(record, "library_never_played"),
    suggestions_pending: numberValue(record, "suggestions_pending"),
    questions_observed: numberValue(record, "questions_observed"),
    questions_adapted: numberValue(record, "questions_adapted"),
    most_used: arrayValue<UsedQuestion>(record, "most_used"),
    supply_by_difficulty: arrayValue<SupplyRow>(record, "supply_by_difficulty"),
    supply_by_mechanic: arrayValue<SupplyRow>(record, "supply_by_mechanic"),
    supply_by_category: arrayValue<SupplyRow>(record, "supply_by_category"),
  };
}

function formatAnswer(value: Json) {
  if (Array.isArray(value)) return value.map(String).join(" · ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function difficultyName(value: number | null | undefined) {
  return value ? DIFFICULTIES[value - 1] ?? "Unrated" : "Unrated";
}

function StatCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <article className="rounded-2xl border border-[#e8e5f4] bg-white p-5 shadow-sm">
      <strong className="block text-3xl font-black tabular-nums text-[#18171f]">{value}</strong>
      <span className="mt-1 block text-sm font-bold text-[#4f4b63]">{label}</span>
      {note ? <span className="mt-1 block text-xs text-[#7b768d]">{note}</span> : null}
    </article>
  );
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busySuggestion, setBusySuggestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setAllowed(false);
      setLoading(false);
      return;
    }

    const { data: access, error: accessError } = await supabase.rpc("is_platform_admin");
    if (accessError || !access) {
      setAllowed(false);
      setError(accessError ? "Could not verify admin access." : null);
      setLoading(false);
      return;
    }

    setAllowed(true);
    const [dashboardResult, suggestionsResult] = await Promise.all([
      supabase.rpc("get_platform_admin_dashboard"),
      supabase.rpc("get_answer_suggestion_queue"),
    ]);
    if (dashboardResult.error || suggestionsResult.error) {
      console.error("Could not load platform admin data:", dashboardResult.error ?? suggestionsResult.error);
      setError("Could not load the admin dashboard. Please try again.");
    } else {
      setDashboard(parseDashboard(dashboardResult.data));
      setSuggestions((suggestionsResult.data ?? []) as Suggestion[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function review(suggestion: Suggestion, decision: "approved" | "rejected") {
    if (busySuggestion) return;
    setBusySuggestion(suggestion.suggestion_id);
    setNotice(null);
    setError(null);
    const { error: reviewError } = await supabase.rpc("review_answer_suggestion", {
      p_suggestion_id: suggestion.suggestion_id,
      p_decision: decision,
      p_note: null,
    });
    if (reviewError) {
      console.error("Could not review answer suggestion:", reviewError);
      setError("Could not save that review decision.");
      setBusySuggestion(null);
      return;
    }
    setSuggestions(current => current.filter(item => item.suggestion_id !== suggestion.suggestion_id));
    setNotice(decision === "approved"
      ? `Added “${suggestion.proposed_answer}” as an accepted answer.`
      : `Rejected “${suggestion.proposed_answer}”.`);
    setBusySuggestion(null);
    void load();
  }

  const lowSupply = useMemo(() => dashboard?.supply_by_category.filter(row => row.question_count < 25) ?? [], [dashboard]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#f6f5fc]"><p className="text-sm font-semibold text-[#6b6880]">Loading admin console…</p></main>;
  }

  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f5fc] px-5">
        <section className="w-full max-w-lg rounded-3xl border border-[#e8e5f4] bg-white p-8 text-center shadow-sm">
          <BrandWordmark className="mx-auto text-lg" />
          <h1 className="mt-7 text-2xl font-black text-[#18171f]">Admin access required</h1>
          <p className="mt-2 text-sm leading-6 text-[#6b6880]">This console is restricted to approved Good Trivia Company administrators.</p>
          {error ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
          <a href="/host" className="mt-6 inline-flex rounded-xl bg-[#7c3aed] px-5 py-3 text-sm font-bold text-white">Return to host dashboard</a>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f5fc]">
      <nav className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#e8e5f4] bg-white px-5 sm:px-8">
        <BrandWordmark compact className="text-sm sm:text-base" />
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-black uppercase tracking-wider text-[#7c3aed]">Admin</span>
          <a href="/host" className="rounded-lg px-3 py-2 text-sm font-bold text-[#6b6880] hover:bg-[#f5f3ff] hover:text-[#7c3aed]">Host app</a>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-5 py-9 sm:px-8 sm:py-11">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#7c3aed]">Good Trivia Company</p>
            <h1 className="mt-2 text-3xl font-black text-[#18171f]">Platform admin</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6b6880]">Live operational health, Question Library supply, observed difficulty, and host-suggested answer alternatives.</p>
          </div>
          <button type="button" onClick={() => void load()} className="rounded-xl border border-[#dcd7ee] bg-white px-4 py-2.5 text-sm font-bold text-[#4f4b63] hover:border-[#7c3aed] hover:text-[#7c3aed]">Refresh data</button>
        </div>

        {error ? <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

        {dashboard ? (
          <>
            <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Quizzes run" value={dashboard.games_total} note={`${dashboard.games_last_7_days} this week · ${dashboard.games_last_30_days} this month`} />
              <StatCard label="Live now" value={dashboard.games_live} note={`${dashboard.unique_hosts} hosts have run a show`} />
              <StatCard label="Teams served" value={dashboard.teams_total} note={`${dashboard.answers_total} trivia answers submitted`} />
              <StatCard label="Active library" value={dashboard.library_active} note={`${dashboard.library_never_played} have not gathered results yet`} />
              <StatCard label="Questions observed" value={dashboard.questions_observed} note="Pristine library snapshots only" />
              <StatCard label="Difficulty adapted" value={dashboard.questions_adapted} note="Begins after 20 team answers" />
              <StatCard label="Answer suggestions" value={dashboard.suggestions_pending} note="Reached the three-host review threshold" />
              <StatCard label="Supply warnings" value={lowSupply.length} note="Categories with fewer than 25 active questions" />
            </section>

            <section className="mt-8 rounded-3xl border border-[#e8e5f4] bg-white p-5 shadow-sm sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-[#18171f]">Answer review queue</h2>
                  <p className="mt-1 text-sm text-[#6b6880]">A suggestion becomes ready after three distinct hosts accept the same alternative on an unchanged library question.</p>
                </div>
                <span className="rounded-full bg-[#f5f3ff] px-3 py-1 text-xs font-black text-[#7c3aed]">{suggestions.length} open</span>
              </div>

              {suggestions.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-[#dcd7ee] px-5 py-10 text-center text-sm font-semibold text-[#7b768d]">No answer alternatives are waiting for review.</div>
              ) : (
                <div className="mt-6 space-y-4">
                  {suggestions.map(suggestion => (
                    <article key={suggestion.suggestion_id} className="rounded-2xl border border-[#e8e5f4] bg-[#fbfaff] p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${suggestion.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}>{suggestion.status === "pending" ? "Ready for review" : "Gathering evidence"}</span>
                            <span className="text-xs font-bold text-[#7b768d]">{suggestion.distinct_host_count} distinct host{suggestion.distinct_host_count === 1 ? "" : "s"}</span>
                          </div>
                          <h3 className="mt-3 text-base font-black leading-6 text-[#18171f]">{suggestion.question_prompt}</h3>
                          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                            <div><dt className="text-xs font-bold uppercase tracking-wider text-[#8a849c]">Current answer</dt><dd className="mt-1 font-semibold text-[#4f4b63]">{formatAnswer(suggestion.current_answer)}</dd></div>
                            <div><dt className="text-xs font-bold uppercase tracking-wider text-[#8a849c]">Host-approved alternative</dt><dd className="mt-1 font-black text-[#7c3aed]">{suggestion.proposed_answer}</dd></div>
                            <div><dt className="text-xs font-bold uppercase tracking-wider text-[#8a849c]">Answer slot</dt><dd className="mt-1 font-semibold text-[#4f4b63]">{suggestion.answer_slot + 1}</dd></div>
                          </dl>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button type="button" disabled={busySuggestion === suggestion.suggestion_id} onClick={() => void review(suggestion, "rejected")} className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50">Reject</button>
                          <button type="button" disabled={busySuggestion === suggestion.suggestion_id} onClick={() => void review(suggestion, "approved")} className="rounded-xl bg-[#7c3aed] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Approve alias</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <div className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
              <section className="rounded-3xl border border-[#e8e5f4] bg-white p-5 shadow-sm sm:p-7">
                <h2 className="text-xl font-black text-[#18171f]">Question supply</h2>
                <p className="mt-1 text-sm text-[#6b6880]">Low counts flag where Auto‑Build choice is likely to feel repetitive.</p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-[#8a849c]">By difficulty</h3>
                    <div className="mt-3 space-y-2">{dashboard.supply_by_difficulty.map(row => <div key={String(row.difficulty)} className="flex justify-between rounded-lg bg-[#f8f7fd] px-3 py-2 text-sm"><span className="font-semibold text-[#4f4b63]">{difficultyName(row.difficulty)}</span><strong className="tabular-nums text-[#18171f]">{row.question_count}</strong></div>)}</div>
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-[#8a849c]">By mechanic</h3>
                    <div className="mt-3 space-y-2">{dashboard.supply_by_mechanic.map(row => <div key={row.question_type} className="flex justify-between rounded-lg bg-[#f8f7fd] px-3 py-2 text-sm"><span className="font-semibold capitalize text-[#4f4b63]">{row.question_type?.replaceAll("-", " ")}</span><strong className="tabular-nums text-[#18171f]">{row.question_count}</strong></div>)}</div>
                  </div>
                </div>
                <h3 className="mt-7 text-xs font-black uppercase tracking-wider text-[#8a849c]">By category</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">{dashboard.supply_by_category.map(row => <div key={row.category_name} className={`flex justify-between rounded-lg px-3 py-2 text-sm ${row.question_count < 25 ? "bg-amber-50 text-amber-900" : "bg-[#f8f7fd] text-[#4f4b63]"}`}><span className="font-semibold">{row.category_name}</span><strong className="tabular-nums">{row.question_count}{row.question_count < 25 ? " · low" : ""}</strong></div>)}</div>
              </section>

              <section className="rounded-3xl border border-[#e8e5f4] bg-white p-5 shadow-sm sm:p-7">
                <h2 className="text-xl font-black text-[#18171f]">Most-used questions</h2>
                <p className="mt-1 text-sm text-[#6b6880]">Usage and performance only count unchanged Question Library snapshots.</p>
                <div className="mt-5 space-y-3">
                  {dashboard.most_used.length === 0 ? <p className="rounded-xl border border-dashed border-[#dcd7ee] px-4 py-8 text-center text-sm text-[#7b768d]">Performance data will appear after new games are scored.</p> : dashboard.most_used.map(question => (
                    <article key={question.id} className="rounded-xl border border-[#eeeaf7] p-4">
                      <p className="line-clamp-2 text-sm font-bold leading-5 text-[#18171f]">{question.prompt}</p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-[#7b768d]">
                        <span>{question.uses} team answers</span><span>{question.correct_percent}% correct</span>
                        <span>{difficultyName(question.editorial_difficulty)} → {difficultyName(question.observed_difficulty ?? question.editorial_difficulty)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
