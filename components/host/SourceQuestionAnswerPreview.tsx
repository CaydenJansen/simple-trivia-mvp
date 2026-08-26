import { sourceQuestionBonusDraft } from '@/lib/trivia/source-question-bonus'
import { sourceQuestionPreview } from '@/lib/trivia/source-question-preview'
import type { Json } from '@/lib/supabase/database.types'

type PreviewQuestion = {
  question_type: string
  correct_answer: unknown
  accepted_answers: unknown
  options: unknown
  bonus?: Json | null
}

export default function SourceQuestionAnswerPreview({ question }: { question: PreviewQuestion }) {
  const preview = sourceQuestionPreview({
    questionType: question.question_type,
    correctAnswer: question.correct_answer,
    acceptedAnswers: question.accepted_answers,
    options: question.options,
  })
  const bonus = sourceQuestionBonusDraft(question.bonus)

  return (
    <div className="mt-3 space-y-2">
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-3.5 py-3">
        {preview.kind === 'multiple-choice' ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {preview.rows.map((row, index) => (
              <div key={`${row.label}-${index}`} className="flex min-w-0 items-start gap-2 text-xs">
                <span className={`w-5 shrink-0 font-bold ${row.correct ? 'text-emerald-600' : 'text-zinc-400'}`}>
                  {row.correct ? '✓' : row.label}
                </span>
                <span className={row.correct ? 'font-bold text-zinc-900' : 'text-zinc-500'}>{row.answer || '—'}</span>
              </div>
            ))}
          </div>
        ) : preview.kind === 'multi-part' ? (
          <div className="space-y-2.5">
            {preview.rows.map((row, index) => (
              <div key={`${row.label}-${index}`} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 font-bold text-violet-600">{row.label}</span>
                <div className="min-w-0">
                  <p className="leading-5 text-zinc-600">{row.prompt || 'Part prompt not set'}</p>
                  <p className="leading-5">
                    <span className="font-bold text-emerald-600">Answer:</span>{' '}
                    <span className="font-bold text-zinc-900">{row.answer || '—'}</span>
                  </p>
                  {row.aliases.length > 0 ? <p className="leading-5 text-zinc-500">Also accept: {row.aliases.join(' · ')}</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : preview.kind === 'multi-answer' ? (
          <div className="space-y-1.5">
            {preview.rows.map((row, index) => (
              <div key={`${row.answer}-${index}`} className="text-xs">
                <p>
                  <span className="font-bold text-emerald-600">{row.label}.</span>{' '}
                  <span className="font-bold text-zinc-900">{row.answer || '—'}</span>
                </p>
                {row.aliases.length > 0 ? <p className="pl-4 text-zinc-500">Also accept: {row.aliases.join(' · ')}</p> : null}
              </div>
            ))}
          </div>
        ) : preview.kind === 'ranking' ? (
          <div className="text-xs">
            <p className="mb-1 font-bold text-emerald-600">Correct order</p>
            <ol className="space-y-0.5 text-zinc-900">
              {preview.rows.map((row, index) => <li key={`${row.answer}-${index}`}>{row.label}. {row.answer || '—'}</li>)}
            </ol>
          </div>
        ) : (
          <div className="text-xs">
            <p>
              <span className="font-bold text-emerald-600">Answer:</span>{' '}
              <span className="font-bold text-zinc-900">{preview.rows[0]?.answer || '—'}</span>
            </p>
            {preview.rows[0]?.aliases.length ? <p className="mt-1 text-zinc-500">Also accept: {preview.rows[0].aliases.join(' · ')}</p> : null}
          </div>
        )}
      </div>

      {bonus.enabled ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-3.5 py-3 text-xs">
          <p className="font-bold text-violet-700">Bonus · {bonus.points} {bonus.points === 1 ? 'point' : 'points'}</p>
          <p className="mt-1 font-semibold leading-5 text-zinc-900">{bonus.prompt || 'Bonus prompt not set'}</p>
          <p className="mt-0.5 leading-5">
            <span className="font-bold text-emerald-600">Answer:</span>{' '}
            <span className="font-bold text-zinc-900">{bonus.answer || '—'}</span>
          </p>
          {bonus.aliases ? <p className="leading-5 text-zinc-500">Also accept: {bonus.aliases}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
