import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { gradingPoints, multiAnswerMissing, storedSubmissionGrading } from './grading'
import { bonusGradingPoints, runtimeBonusFromJson, storedBonusGrading } from './bonus-grading'
import { speedAward } from './speed-scoring'

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
    for (const { scored, speed } of [{ scored: false, speed: null }, { scored: true, speed: null }, { scored: true, speed: 75 }]) {
      it(`${name} ${scored ? 'rescores previously scored' : 'only reviews unscored'} answers while closed${speed ? ' with speed points' : ''}`, async () => {
        const submission = { id: 's1', team_id: 't1', question_key: 'q1', answer_text: 'Canada', is_correct: scored ? false : null, points_awarded: 0, speed_points_max: speed, grading_json: { items: [{ submitted: 'Canada', expected: 'Canada', status: 'incorrect' }] } }
        const question = { question_key: 'q1', question_type: 'single-answer', correct_answer: 'Canada', options: null, points_max: 1, bonus: { prompt: 'Bonus?', correct_answer: 'Canada', points: 1 } }
        const rpc = vi.fn(async (...args: unknown[]) => ({ error: null, args }))
        const update = vi.fn(() => ({ eq: async () => ({ error: null }) }))
        const errors: string[] = []
        let updated = submission
        const setter = (updateRows: (rows: typeof submission[]) => typeof submission[]) => { updated = updateRows([submission])[0] }
        const context = vm.createContext({
          question, phase: 'closed', submissions: [submission], bonusSubmissions: [submission], roundQuestions: [question],
          storedSubmissionGrading, storedBonusGrading, runtimeBonusFromJson, bonusGradingPoints, gradingPoints, multiAnswerMissing, speedAward,
          reviewBusyRef: { current: new Set() }, roundReviewBusyRef: { current: new Set() },
          liveGameId: null, gameId: null, supabase: { rpc, from: () => ({ update }) },
          setSubmissions: setter, setBonusSubmissions: setter, setRoundSubmissions: setter, setRoundBonusSubmissions: setter,
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
          expect(updated.points_awarded).toBe(speed ?? 1)
          expect(updated.is_correct).toBe(true)
        } else {
          expect(update).toHaveBeenCalled()
          expect(rpc.mock.calls.some(call => String(call[0]).startsWith('rescore_'))).toBe(false)
        }
      })
    }
  }

  for (const name of ['handleBonusReview', 'reviewRoundSubmission']) {
    for (const speed of [null, 50, 75, 100]) {
      it(`${name} preserves a three-point bonus on corrections at speed ${speed ?? 'classic'}`, async () => {
        const submission = { id: 's1', team_id: 't1', question_key: 'q1', answer_text: 'Canada', is_correct: false, points_awarded: 0, speed_points_max: speed, grading_json: { items: [{ submitted: 'Canada', expected: 'Canada', status: 'incorrect' }] } }
        const question = { question_key: 'q1', points_max: 1, bonus: { prompt: 'Bonus?', correct_answer: 'Canada', points: 3 } }
        const rpc = vi.fn(async () => ({ error: null }))
        let updated = submission
        const setter = (fn: (rows: typeof submission[]) => typeof submission[]) => { updated = fn([updated])[0] }
        const errors: string[] = []
        const context = vm.createContext({
          question, bonusSubmissions: [submission], roundQuestions: [question],
          storedBonusGrading, runtimeBonusFromJson, bonusGradingPoints, speedAward,
          reviewBusyRef: { current: new Set() }, roundReviewBusyRef: { current: new Set() },
          liveGameId: null, gameId: null, supabase: { rpc },
          setBonusSubmissions: setter, setRoundBonusSubmissions: setter,
          setLiveError: (message: string) => errors.push(message), setError: (message: string) => errors.push(message), console,
        })
        vm.runInContext(handler(name), context)
        for (const status of ['correct', 'incorrect', 'correct'] as const) {
          context.bonusSubmissions = [updated]
          if (name === 'handleBonusReview') await context[name]('s1', status)
          else await context[name](updated, 0, status, true)
          const rawPoints = status === 'correct' ? 3 : 0
          expect(errors).toEqual([])
          expect(rpc).toHaveBeenLastCalledWith('rescore_bonus_submission', expect.objectContaining({ p_points_awarded: rawPoints }))
          expect(updated.points_awarded).toBe(rawPoints * (speed ?? 1))
          expect(updated.is_correct).toBe(status === 'correct')
        }
      })
    }
  }
})
