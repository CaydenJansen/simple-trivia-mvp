import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { gradingPoints, multiAnswerMissing, storedSubmissionGrading } from './grading'
import { runtimeBonusFromJson, storedBonusGrading } from './bonus-grading'

// Exercise the actual component handlers, including their persistence branch.
// Database tests separately verify that the rescore RPC changes team totals.
const source = ts.createSourceFile('HostPrototype.tsx', readFileSync('components/host/HostPrototype.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function handler(name: string) {
  let code = ''
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) code = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!code) throw new Error(`Missing handler ${name}`)
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
}

describe('host review persistence', () => {
  for (const name of ['handleReviewItem', 'handleBonusReview', 'reviewRoundSubmission']) {
    for (const scored of [false, true]) {
      it(`${name} ${scored ? 'rescores previously scored' : 'only reviews unscored'} answers while closed`, async () => {
        const submission = { id: 's1', team_id: 't1', question_key: 'q1', answer_text: 'Canada', is_correct: scored ? false : null, points_awarded: 0, grading_json: { items: [{ submitted: 'Canada', expected: 'Canada', status: 'incorrect' }] } }
        const question = { question_key: 'q1', question_type: 'single-answer', correct_answer: 'Canada', options: null, points_max: 1, bonus: { prompt: 'Bonus?', correct_answer: 'Canada', points: 1 } }
        const rpc = vi.fn(async (...args: unknown[]) => ({ error: null, args }))
        const update = vi.fn(() => ({ eq: async () => ({ error: null }) }))
        const errors: string[] = []
        const context = vm.createContext({
          question, phase: 'closed', submissions: [submission], bonusSubmissions: [submission], roundQuestions: [question],
          storedSubmissionGrading, storedBonusGrading, runtimeBonusFromJson, gradingPoints, multiAnswerMissing,
          reviewBusyRef: { current: new Set() }, roundReviewBusyRef: { current: new Set() },
          liveGameId: null, gameId: null, supabase: { rpc, from: () => ({ update }) },
          setSubmissions: () => {}, setBonusSubmissions: () => {}, setRoundSubmissions: () => {}, setRoundBonusSubmissions: () => {},
          setLiveError: (message: string) => errors.push(message), setError: (message: string) => errors.push(message), console,
        })
        vm.runInContext(handler(name), context)
        if (name === 'handleBonusReview') await context[name]('s1', 'correct')
        else if (name === 'reviewRoundSubmission') await context[name](submission, 0, 'correct')
        else await context[name]('s1', 0, 'correct')
        expect(errors).toEqual([])
        if (scored) {
          expect(rpc).toHaveBeenCalledWith(name === 'handleBonusReview' ? 'rescore_bonus_submission' : 'rescore_submission', expect.objectContaining({ p_submission_id: 's1', p_points_awarded: 1 }))
          expect(update).not.toHaveBeenCalled()
        } else {
          expect(update).toHaveBeenCalled()
          expect(rpc.mock.calls.some(call => String(call[0]).startsWith('rescore_'))).toBe(false)
        }
      })
    }
  }
})
