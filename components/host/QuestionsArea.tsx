"use client";

import { useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import type {
  Database,
  Json,
  QuestionStatus,
  QuestionType,
} from "@/lib/supabase/database.types";

type SourceQuestion = Database["public"]["Tables"]["source_questions"]["Row"];
type QuestionTab = "mine" | "library";

type QuestionDraft = {
  prompt: string;
  questionType: QuestionType;
  category: string;
  difficulty: string;
  tags: string;
  imageUrl: string;
  notes: string;
  status: QuestionStatus;
  answers: string[];
  aliases: string[];
  options: string[];
  clues: string[];
  correctOption: number;
};

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "single-answer", label: "Single Answer" },
  { value: "image-question", label: "Image Question" },
  { value: "multiple-choice", label: "Multiple Choice" },
  { value: "multi-answer", label: "Multi-Answer" },
  { value: "multi-part", label: "Multi-Part" },
  { value: "ranking", label: "Ranking" },
];

const EMPTY_DRAFT: QuestionDraft = {
  prompt: "",
  questionType: "single-answer",
  category: "",
  difficulty: "",
  tags: "",
  imageUrl: "",
  notes: "",
  status: "active",
  answers: [""],
  aliases: [""],
  options: ["", "", "", ""],
  clues: [""],
  correctOption: 0,
};

function strings(value: Json | null): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
}

function aliasesForQuestion(question: SourceQuestion, count: number): string[] {
  const acceptedAnswers = question.accepted_answers;
  if (!Array.isArray(acceptedAnswers)) return Array(count).fill("");

  if (question.question_type === "single-answer" || question.question_type === "image-question") {
    return [acceptedAnswers.map((value) => String(value)).join(", ")];
  }

  return Array.from({ length: count }, (_, index) => {
    const aliases = acceptedAnswers[index];
    return Array.isArray(aliases) ? aliases.map((value) => String(value)).join(", ") : "";
  });
}

function draftFromQuestion(question: SourceQuestion): QuestionDraft {
  const compoundAnswers = strings(question.correct_answer);
  const answers = question.question_type === "single-answer" || question.question_type === "image-question"
    ? [String(question.correct_answer ?? "")]
    : compoundAnswers.length > 0 ? compoundAnswers : [""];
  const structuredOptions = Array.isArray(question.options) ? question.options : [];
  const choiceOptions = structuredOptions.map((option) => {
    if (option && typeof option === "object" && !Array.isArray(option)) {
      return String(option.label ?? "");
    }
    return String(option ?? "");
  });
  const clues = structuredOptions.map((option) => {
    if (option && typeof option === "object" && !Array.isArray(option)) {
      return String(option.clue ?? "");
    }
    return "";
  });
  const correctKey = String(question.correct_answer ?? "A");

  return {
    prompt: question.prompt,
    questionType: question.question_type,
    category: question.category ?? "",
    difficulty: question.difficulty ?? "",
    tags: question.tags.join(", "),
    imageUrl: question.image_url ?? "",
    notes: question.notes ?? "",
    status: question.status,
    answers,
    aliases: aliasesForQuestion(question, answers.length),
    options: choiceOptions.length > 0 ? choiceOptions : ["", "", "", ""],
    clues: clues.length > 0 ? clues : Array(answers.length).fill(""),
    correctOption: Math.max(0, correctKey.charCodeAt(0) - 65),
  };
}

function splitAliases(value: string) {
  return value.split(",").map((alias) => alias.trim()).filter(Boolean);
}

function questionPayload(draft: QuestionDraft) {
  const answers = draft.answers.map((answer) => answer.trim());
  const options = draft.options.map((option) => option.trim());
  let correctAnswer: Json;
  let storedOptions: Json | null = null;
  let acceptedAnswers: Json = [];

  if (draft.questionType === "single-answer" || draft.questionType === "image-question") {
    correctAnswer = draft.answers[0]?.trim() ?? "";
    acceptedAnswers = splitAliases(draft.aliases[0] ?? "");
  } else if (draft.questionType === "multiple-choice") {
    correctAnswer = String.fromCharCode(65 + draft.correctOption);
    storedOptions = options.map((label, index) => ({
      key: String.fromCharCode(65 + index),
      label,
    }));
  } else if (draft.questionType === "multi-part") {
    correctAnswer = answers;
    storedOptions = answers.map((_, index) => ({
      label: String.fromCharCode(65 + index),
      clue: draft.clues[index]?.trim() ?? "",
    }));
    acceptedAnswers = answers.map((_, index) => splitAliases(draft.aliases[index] ?? ""));
  } else if (draft.questionType === "ranking") {
    correctAnswer = answers;
    storedOptions = answers;
  } else {
    correctAnswer = answers;
    acceptedAnswers = answers.map((_, index) => splitAliases(draft.aliases[index] ?? ""));
  }

  return {
    question_type: draft.questionType,
    prompt: draft.prompt.trim(),
    correct_answer: correctAnswer,
    accepted_answers: acceptedAnswers,
    options: storedOptions,
    category: draft.category.trim() || null,
    difficulty: draft.difficulty || null,
    tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    image_url: draft.imageUrl.trim() || null,
    notes: draft.notes.trim() || null,
    status: draft.status,
  };
}

function validateDraft(draft: QuestionDraft) {
  if (!draft.prompt.trim()) return "Add the question text.";

  if (draft.questionType === "multiple-choice") {
    const options = draft.options.map((option) => option.trim());
    if (options.some((option) => !option)) return "Fill all four multiple-choice options.";
    if (!options[draft.correctOption]) return "Choose the correct option.";
    return null;
  }

  const answers = draft.answers.map((answer) => answer.trim());
  if (answers.some((answer) => !answer)) return "Fill each answer row or remove the empty row.";
  if (draft.questionType === "ranking" && answers.length < 2) return "Add at least two ranking items.";
  if (draft.questionType === "multi-part") {
    const missingClue = answers.some((_, index) => !draft.clues[index]?.trim());
    if (missingClue) return "Add a clue for every multi-part answer.";
  }
  return null;
}

function answerSummary(question: SourceQuestion) {
  if (question.question_type === "multiple-choice" && Array.isArray(question.options)) {
    const correctKey = String(question.correct_answer);
    const match = question.options.find((option) => (
      option && typeof option === "object" && !Array.isArray(option) && option.key === correctKey
    ));
    if (match && typeof match === "object" && !Array.isArray(match)) return String(match.label ?? correctKey);
    return correctKey;
  }
  return Array.isArray(question.correct_answer)
    ? question.correct_answer.map(String).join(" · ")
    : String(question.correct_answer ?? "");
}

function questionTypeLabel(type: QuestionType) {
  return QUESTION_TYPES.find((option) => option.value === type)?.label ?? type;
}

export default function QuestionsArea() {
  const [tab, setTab] = useState<QuestionTab>("mine");
  const [questions, setQuestions] = useState<SourceQuestion[]>([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType | "all">("all");
  const [difficulty, setDifficulty] = useState("");
  const [status, setStatus] = useState<QuestionStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<SourceQuestion | null | "new">(null);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      async function loadQuestions() {
        setLoading(true);
        setLoadError(null);

        let query = supabase
          .from("source_questions")
          .select("*", { count: "exact" })
          .eq("origin", tab === "mine" ? "user" : "platform")
          .order("updated_at", { ascending: false })
          .range(0, 49);

        if (search.trim()) query = query.ilike("prompt", `%${search.trim()}%`);
        if (questionType !== "all") query = query.eq("question_type", questionType);
        if (difficulty) query = query.eq("difficulty", difficulty);
        if (tab === "mine" && status !== "all") query = query.eq("status", status);

        const { data, error, count: total } = await query;
        if (!active) return;

        if (error) {
          console.error("Could not load source questions:", error);
          setLoadError("Could not load questions. Try again.");
          setQuestions([]);
          setCount(0);
        } else {
          setQuestions(data ?? []);
          setCount(total ?? 0);
        }
        setLoading(false);
      }

      void loadQuestions();
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [tab, search, questionType, difficulty, status, refresh]);

  function changeTab(nextTab: QuestionTab) {
    setTab(nextTab);
    setSearch("");
    setQuestionType("all");
    setDifficulty("");
    setStatus("all");
  }

  const title = tab === "mine" ? "My Questions" : "Question Library";
  const description = tab === "mine"
    ? "Create and manage reusable questions you own. Quiz copies will remain independent."
    : "Browse platform-provided questions. Library records are read-only for hosts.";

  return (
    <main className="mx-auto max-w-6xl px-6 py-9">
      <div className="mb-7 inline-flex rounded-xl border border-zinc-200 bg-white p-1">
        {(["mine", "library"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => changeTab(value)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === value ? "bg-violet-600 text-white" : "text-zinc-500 hover:bg-violet-50 hover:text-violet-700"
            }`}
          >
            {value === "mine" ? "My Questions" : "Question Library"}
          </button>
        ))}
      </div>

      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-violet-600">Questions</p>
          <h1 className="text-3xl font-extrabold text-zinc-900">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{description}</p>
        </div>
        {tab === "mine" ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700"
          >
            + Write New
          </button>
        ) : null}
      </div>

      <section className="mb-5 grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 md:grid-cols-[1fr_180px_150px_150px]">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className="rounded-xl border border-zinc-200 px-3.5 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        />
        <select
          value={questionType}
          onChange={(event) => setQuestionType(event.target.value as QuestionType | "all")}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 outline-none focus:border-violet-500"
        >
          <option value="all">All types</option>
          {QUESTION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 outline-none focus:border-violet-500"
        >
          <option value="">All difficulties</option>
          <option>Easy</option>
          <option>Medium</option>
          <option>Hard</option>
        </select>
        {tab === "mine" ? (
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as QuestionStatus | "all")}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 outline-none focus:border-violet-500"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        ) : <div className="hidden md:block" />}
      </section>

      <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
        <span>{loading ? "Loading…" : `${count} question${count === 1 ? "" : "s"}`}</span>
        {count > 50 ? <span>Showing the newest 50</span> : null}
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">{loadError}</div>
      ) : loading ? (
        <div className="py-24 text-center text-sm text-zinc-500">Loading questions…</div>
      ) : questions.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white px-6 py-20 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-xl text-violet-700">?</div>
          <h2 className="font-bold text-zinc-900">
            {search || questionType !== "all" || difficulty || status !== "all"
              ? "No matching questions"
              : tab === "mine" ? "No questions saved yet" : "Question Library is empty"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
            {tab === "mine" ? "Write a reusable question here. Adding it to a quiz will create an independent copy later." : "Platform questions will appear here once active library content has been added."}
          </p>
          {tab === "mine" ? (
            <button type="button" onClick={() => setEditing("new")} className="mt-5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">Write New</button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              editable={tab === "mine"}
              onEdit={() => setEditing(question)}
              onChanged={() => setRefresh((value) => value + 1)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <QuestionEditor
          question={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setRefresh((value) => value + 1);
          }}
        />
      ) : null}
    </main>
  );
}

function QuestionCard({
  question,
  editable,
  onEdit,
  onChanged,
}: {
  question: SourceQuestion;
  editable: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const statusColors: Record<QuestionStatus, string> = {
    active: "bg-emerald-50 text-emerald-700",
    draft: "bg-amber-50 text-amber-700",
    needs_review: "bg-orange-50 text-orange-700",
    archived: "bg-zinc-100 text-zinc-500",
  };

  async function removeQuestion() {
    if (!window.confirm("Delete this source question? Existing quiz copies will not be deleted.")) return;
    setDeleting(true);
    const { error } = await supabase.from("source_questions").delete().eq("id", question.id);
    setDeleting(false);
    if (error) {
      window.alert("Could not delete this question.");
      return;
    }
    onChanged();
  }

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 transition hover:border-violet-200 hover:shadow-sm">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{questionTypeLabel(question.question_type)}</span>
            {question.category ? <span className="text-xs text-zinc-500">{question.category}</span> : null}
            {question.difficulty ? <span className="text-xs text-zinc-500">· {question.difficulty}</span> : null}
            {question.is_verified ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">✓ Verified</span> : null}
            {editable ? <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusColors[question.status]}`}>{question.status.replace("_", " ")}</span> : null}
          </div>
          <h2 className="text-[15px] font-bold leading-6 text-zinc-900">{question.prompt}</h2>
          <p className="mt-2 truncate text-sm text-zinc-500"><span className="font-medium text-zinc-700">Answer:</span> {answerSummary(question)}</p>
          {question.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {question.tags.map((tag) => <span key={tag} className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-500">{tag}</span>)}
            </div>
          ) : null}
        </div>
        {editable ? (
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onEdit} className="rounded-lg px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50">Edit</button>
            <button type="button" disabled={deleting} onClick={() => void removeQuestion()} className="rounded-lg px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">{deleting ? "Deleting…" : "Delete"}</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function QuestionEditor({
  question,
  onClose,
  onSaved,
}: {
  question: SourceQuestion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(() => question ? draftFromQuestion(question) : { ...EMPTY_DRAFT });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCompound = draft.questionType === "multi-answer" || draft.questionType === "multi-part" || draft.questionType === "ranking";

  const rowCount = useMemo(() => Math.max(1, draft.answers.length), [draft.answers.length]);

  function updateAnswer(index: number, value: string) {
    setDraft((current) => ({ ...current, answers: current.answers.map((answer, row) => row === index ? value : answer) }));
  }

  function updateAlias(index: number, value: string) {
    setDraft((current) => ({ ...current, aliases: Array.from({ length: Math.max(current.aliases.length, rowCount) }, (_, row) => row === index ? value : current.aliases[row] ?? "") }));
  }

  function addAnswerRow() {
    setDraft((current) => ({ ...current, answers: [...current.answers, ""], aliases: [...current.aliases, ""], clues: [...current.clues, ""] }));
  }

  function removeAnswerRow(index: number) {
    setDraft((current) => ({
      ...current,
      answers: current.answers.filter((_, row) => row !== index),
      aliases: current.aliases.filter((_, row) => row !== index),
      clues: current.clues.filter((_, row) => row !== index),
    }));
  }

  async function saveQuestion() {
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setSaving(false);
      setError("Your host session has expired. Sign in again.");
      return;
    }

    const payload = questionPayload(draft);
    const result = question
      ? await supabase.from("source_questions").update(payload).eq("id", question.id)
      : await supabase.from("source_questions").insert({
          ...payload,
          origin: "user",
          owner_id: authData.user.id,
        });

    setSaving(false);
    if (result.error) {
      console.error("Could not save source question:", result.error);
      setError("Could not save this question. Check the fields and try again.");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-zinc-950/45 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-zinc-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">{question ? "Edit My Question" : "Write New Question"}</h2>
            <p className="mt-1 text-sm text-zinc-500">This reusable source remains separate from every quiz copy.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100">Close</button>
        </header>

        <div className="space-y-6 px-6 py-6">
          <label className="block">
            <span className="text-sm font-semibold text-zinc-700">Question text</span>
            <textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" placeholder="What would you like to ask?" />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-zinc-700">Question type</span>
              <select value={draft.questionType} onChange={(event) => setDraft({ ...EMPTY_DRAFT, prompt: draft.prompt, category: draft.category, difficulty: draft.difficulty, tags: draft.tags, notes: draft.notes, status: draft.status, questionType: event.target.value as QuestionType })} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm outline-none focus:border-violet-500">
                {QUESTION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-zinc-700">Category</span>
              <input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-3 text-sm outline-none focus:border-violet-500" placeholder="Geography" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-zinc-700">Difficulty</span>
              <select value={draft.difficulty} onChange={(event) => setDraft({ ...draft, difficulty: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm outline-none focus:border-violet-500">
                <option value="">Not set</option><option>Easy</option><option>Medium</option><option>Hard</option>
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-5">
            <h3 className="mb-4 text-sm font-bold text-zinc-900">Answer setup</h3>

            {draft.questionType === "multiple-choice" ? (
              <div className="space-y-3">
                {draft.options.map((option, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <input type="radio" name="correct-choice" checked={draft.correctOption === index} onChange={() => setDraft({ ...draft, correctOption: index })} className="h-4 w-4 accent-violet-600" aria-label={`Mark option ${String.fromCharCode(65 + index)} correct`} />
                    <span className="w-5 text-sm font-bold text-violet-700">{String.fromCharCode(65 + index)}</span>
                    <input value={option} onChange={(event) => setDraft({ ...draft, options: draft.options.map((value, row) => row === index ? event.target.value : value) })} className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500" placeholder={`Option ${String.fromCharCode(65 + index)}`} />
                  </div>
                ))}
              </div>
            ) : isCompound ? (
              <div className="space-y-3">
                {draft.answers.map((answer, index) => (
                  <div key={index} className="rounded-xl border border-zinc-200 bg-white p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-2.5 w-6 text-center text-xs font-bold text-violet-700">{draft.questionType === "multi-part" ? String.fromCharCode(65 + index) : index + 1}</span>
                      <div className="flex-1 space-y-2">
                        {draft.questionType === "multi-part" ? <input value={draft.clues[index] ?? ""} onChange={(event) => setDraft({ ...draft, clues: Array.from({ length: rowCount }, (_, row) => row === index ? event.target.value : draft.clues[row] ?? "") })} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-violet-500" placeholder="Clue" /> : null}
                        <input value={answer} onChange={(event) => updateAnswer(index, event.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-violet-500" placeholder={draft.questionType === "ranking" ? "Item in correct order" : "Correct answer"} />
                        {draft.questionType !== "ranking" ? <input value={draft.aliases[index] ?? ""} onChange={(event) => updateAlias(index, event.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs outline-none focus:border-violet-500" placeholder="Accepted alternatives, separated by commas" /> : null}
                      </div>
                      {draft.answers.length > 1 ? <button type="button" onClick={() => removeAnswerRow(index)} className="mt-2 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Remove</button> : null}
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addAnswerRow} className="rounded-lg px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100">+ Add {draft.questionType === "ranking" ? "item" : "answer"}</button>
              </div>
            ) : (
              <div className="space-y-3">
                <input value={draft.answers[0] ?? ""} onChange={(event) => updateAnswer(0, event.target.value)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500" placeholder="Correct answer" />
                <input value={draft.aliases[0] ?? ""} onChange={(event) => updateAlias(0, event.target.value)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-500" placeholder="Accepted alternatives, separated by commas" />
              </div>
            )}
          </div>

          {draft.questionType === "image-question" ? (
            <label className="block"><span className="text-sm font-semibold text-zinc-700">Image URL</span><input type="url" value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-3 text-sm outline-none focus:border-violet-500" placeholder="https://…" /></label>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className="text-sm font-semibold text-zinc-700">Tags</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-3 text-sm outline-none focus:border-violet-500" placeholder="capitals, australia, geography" /></label>
            <label className="block"><span className="text-sm font-semibold text-zinc-700">Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as QuestionStatus })} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm outline-none focus:border-violet-500"><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select></label>
          </div>
          <label className="block"><span className="text-sm font-semibold text-zinc-700">Host notes</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={2} className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-3 text-sm outline-none focus:border-violet-500" placeholder="Optional context for the host" /></label>

          {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p> : null}
        </div>

        <footer className="flex justify-end gap-3 border-t border-zinc-200 px-6 py-5">
          <button type="button" onClick={onClose} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void saveQuestion()} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{saving ? "Saving…" : "Save to My Questions"}</button>
        </footer>
      </div>
    </div>
  );
}
