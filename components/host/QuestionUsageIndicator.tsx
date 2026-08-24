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
      className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-orange-700"
    >
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 font-bold text-orange-700">
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-orange-500 text-[9px] text-white" aria-hidden="true">!</span>
        Already used in {usages.length} {usages.length === 1 ? "quiz" : "quizzes"}
      </span>
      <span className="min-w-0 font-medium leading-4">{questionQuizUsageSummary(usages)}</span>
    </p>
  );
}
