import { questionQuizUsageSummary, type QuestionQuizUsage } from "@/lib/trivia/question-usage";

export default function QuestionUsageIndicator({ usages }: { usages: readonly QuestionQuizUsage[] | null }) {
  if (usages === null) return null;

  const fresh = usages.length === 0;
  const fullUsage = usages.map((usage) => usage.quizTitle).join(", ");

  if (fresh) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Fresh · Not used in your quizzes
      </p>
    );
  }

  return (
    <div
      title={`Used in: ${fullUsage}`}
      className="mt-3 flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 shadow-sm"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white" aria-hidden="true">
        ↻
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-violet-600">
          Used in {usages.length} {usages.length === 1 ? "quiz" : "quizzes"}
        </p>
        <p className="mt-0.5 text-sm font-bold leading-5 text-violet-950">{questionQuizUsageSummary(usages)}</p>
      </div>
    </div>
  );
}
