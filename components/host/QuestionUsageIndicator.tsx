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
    <p
      title={`Used in: ${fullUsage}`}
      className="mt-3 flex flex-wrap items-center gap-2 text-xs text-orange-800"
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-orange-300 bg-orange-100 px-2.5 py-1 font-extrabold text-orange-800">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-600 text-[10px] text-white" aria-hidden="true">!</span>
        Already used in {usages.length} {usages.length === 1 ? "quiz" : "quizzes"}
      </span>
      <span className="min-w-0 font-semibold leading-5">{questionQuizUsageSummary(usages)}</span>
    </p>
  );
}
