import { questionQuizUsageSummary, type QuestionQuizUsage } from "@/lib/trivia/question-usage";

export default function QuestionUsageIndicator({ usages }: { usages: readonly QuestionQuizUsage[] | null }) {
  if (usages === null) return null;

  const fresh = usages.length === 0;
  const fullUsage = usages.map((usage) => usage.quizTitle).join(", ");

  return (
    <p
      title={fresh ? undefined : `Used in: ${fullUsage}`}
      className={`mt-3 flex items-start gap-2 text-xs ${fresh ? "text-emerald-700" : "text-zinc-500"}`}
    >
      <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${fresh ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
        {fresh ? "Fresh" : "Used in"}
      </span>
      <span className="min-w-0 pt-0.5 leading-5">{questionQuizUsageSummary(usages)}</span>
    </p>
  );
}
