"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  leaderboardVisibilityFromSettings,
  playersSeeFinalLeaderboard,
  type LeaderboardVisibility,
} from "@/lib/trivia/leaderboard-visibility";
import {
  answerRevealModeFromSettings,
  type AnswerRevealMode,
} from "@/lib/trivia/answer-reveal";
import { prizeAwardsFromJson, type PrizeAward } from "@/lib/trivia/prizes";
import { PLAYER_SESSION_KEYS, shouldResetPlayerSessionForJoinCode } from "@/lib/trivia/session-recovery";
import { gameCodeFromSearch } from "@/lib/trivia/join-code";
import { runtimeBonusFromJson } from "@/lib/trivia/bonus-grading";
import type { Json } from "@/lib/supabase/database.types";
import { multiAnswerInputCount, playerQuestionStageScreen } from "@/lib/trivia/live-bonus-flow";
import { playersSeeScoresFromSettings } from "@/lib/trivia/score-visibility";
import { gameAcceptsNewTeams, JOINABLE_GAME_STATUSES } from "@/lib/trivia/game-joining";
import { playerTiebreakerOutcome } from "@/lib/trivia/tiebreakers";
import { shouldSubmitPlayerAnswerOnEnter } from "@/lib/trivia/player-keyboard-submit";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type PlayerScreen =
  | 'join' | 'team-setup' | 'waiting' | 'round-start'
  | 'single-answer' | 'image-question' | 'multiple-choice'
  | 'multi-answer' | 'multi-part' | 'ranking'
  | 'bonus-answer' | 'bonus-submitted'
  | 'submitted' | 'no-answer' | 'correct' | 'incorrect'
  | 'partial-correct'
  | 'content-screen' | 'intermission' | 'question-results' | 'round-results' | 'round-results-hidden'
  | 'delayed-reveal' | 'winner' | 'final-result'
  | 'tiebreaker-pending' | 'tiebreaker' | 'tiebreaker-result'
  | 'reconnecting' | 'game-ended'

function submitPlayerAnswerOnEnter(
  event: ReactKeyboardEvent<HTMLElement>,
  enabled: boolean,
  submit: () => void,
) {
  if (!shouldSubmitPlayerAnswerOnEnter({
    key: event.key,
    shiftKey: event.shiftKey,
    isComposing: event.nativeEvent.isComposing,
    enabled,
  })) return

  event.preventDefault()
  submit()
}

const PlayerDevControlsContext = createContext(false)
const PlayerScoreVisibilityContext = createContext(true)

const LIVE_PLAYER_SCREENS = new Set<PlayerScreen>([
  'waiting', 'round-start', 'single-answer', 'image-question', 'multiple-choice',
  'multi-answer', 'multi-part', 'ranking', 'submitted', 'no-answer', 'correct',
  'bonus-answer', 'bonus-submitted',
  'incorrect', 'partial-correct', 'content-screen', 'intermission', 'question-results', 'round-results',
  'round-results-hidden', 'delayed-reveal', 'winner', 'final-result', 'reconnecting', 'game-ended',
  'tiebreaker-pending', 'tiebreaker', 'tiebreaker-result',
])

const QUESTION_SCREENS = new Set<PlayerScreen>([
  'single-answer', 'image-question', 'multiple-choice', 'multi-answer', 'multi-part', 'ranking',
])

type RemoteGameState = {
  current_screen: string | null
  answer_phase: string | null
  question_stage: string | null
  current_question_key: string | null
  current_content_screen_key: string | null
}

type LiveQuestionDefinition = {
  question_key: string
  position: number
  round_number: number
  round_position: number
  round_question_count: number
  round_title: string
  prompt: string
  category: string | null
  difficulty: string | null
  question_type: PlayerScreen
  correct_answer: unknown
  options: unknown
  image_url: string | null
  points_max: number
  notes: string | null
  has_bonus: boolean
  bonus: Json | null
}

type LiveContentScreenDefinition = {
  screen_key: string
  item_position: number
  round_number: number
  round_title: string
  title: string
  body: string | null
  image_url: string | null
}

async function loadPlayerQuestion(gameId: string, questionKey: string) {
  return supabase
    .rpc('get_player_game_question', {
      p_game_id: gameId,
      p_question_key: questionKey,
    })
    .maybeSingle()
}

type PlayerLeaderboardTeam = {
  id: string
  name: string
  score: number
  final_placement: number | null
  final_sort_order: number | null
}

function playerScreenFromGameState(value: string | null | undefined): PlayerScreen | null {
  if (!value) return null
  if (value === 'lobby') return 'waiting'
  return LIVE_PLAYER_SCREENS.has(value as PlayerScreen) ? value as PlayerScreen : null
}

function parseStoredAnswer(value: string): unknown {
  try { return JSON.parse(value) } catch { return value }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : []
}

function optionObjects(value: unknown): { key?: string; label?: string; clue?: string }[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as { key?: string; label?: string; clue?: string }[] : []
}

function playerBonusFromJson(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const bonus = value as Record<string, unknown>
  const prompt = String(bonus.prompt ?? '').trim()
  if (!prompt) return null
  return {
    prompt,
    points: Math.max(1, Number(bonus.points) || 1),
    imageUrl: String(bonus.image_url ?? '').trim() || null,
  }
}

function correctAnswerLabel(question: LiveQuestionDefinition | null) {
  if (!question) return '—'
  if (question.question_type === 'multiple-choice') {
    const key = String(question.correct_answer ?? '')
    const option = optionObjects(question.options).find(item => item.key === key)
    return option?.label ? `${key} · ${option.label}` : key
  }
  if (Array.isArray(question.correct_answer)) return question.correct_answer.map(String).join(' · ')
  return String(question.correct_answer ?? '—')
}

function submittedAnswerLabel(answerText: string, question: LiveQuestionDefinition | null) {
  const parsed = parseStoredAnswer(answerText)
  if (question?.question_type === 'multiple-choice') {
    const key = String(parsed ?? '')
    const option = optionObjects(question.options).find(item => item.key === key)
    return option?.label ? `${key} · ${option.label}` : key
  }
  if (Array.isArray(parsed)) return parsed.map(String).join(' · ')
  return String(parsed ?? '')
}

async function resolveLivePlayerScreen(gameId: string, teamId: string, gameState: RemoteGameState): Promise<PlayerScreen | null> {
  if (gameState.current_screen === 'lobby') return 'waiting'

  const remoteScreen = playerScreenFromGameState(gameState.current_screen)
  if (!remoteScreen) return null

  if (QUESTION_SCREENS.has(remoteScreen)) {
    const questionKey = gameState.current_question_key || 'q1'

    const [{ data: submission, error }, { data: bonusSubmission, error: bonusError }, { data: question }] = await Promise.all([
      supabase
        .from('submissions')
        .select('id, is_correct, points_awarded')
        .eq('game_id', gameId)
        .eq('team_id', teamId)
        .eq('question_key', questionKey)
        .maybeSingle(),
      supabase
        .rpc('get_player_bonus_submission', {
          p_game_id: gameId,
          p_team_id: teamId,
          p_question_key: questionKey,
        })
        .maybeSingle(),
      loadPlayerQuestion(gameId, questionKey),
    ])

    if (error) console.error('Could not check player submission:', error)
    if (bonusError) console.error('Could not check player bonus submission:', bonusError)

    return playerQuestionStageScreen({
      answerPhase: gameState.answer_phase,
      questionStage: gameState.question_stage,
      baseScreen: remoteScreen,
      coreSubmission: submission,
      bonusSubmission,
      corePointsMax: question?.points_max ?? 1,
      bonusPointsMax: runtimeBonusFromJson(question?.bonus)?.points ?? 0,
    }) as PlayerScreen
  }

  return remoteScreen
}

function useLivePlayerSync(
  screen: PlayerScreen,
  setScreen: React.Dispatch<React.SetStateAction<PlayerScreen>>,
  enabled = true,
) {
  const joined = enabled && screen !== 'join' && screen !== 'team-setup'

  useEffect(() => {
    if (!joined) return
    const gameId = localStorage.getItem('simple-trivia-game-id')
    const teamId = localStorage.getItem('simple-trivia-team-id')
    if (!gameId || !teamId) return
    const activeGameId = gameId
    const activeTeamId = teamId

    let active = true

    async function applyGameState(gameState: RemoteGameState) {
      const next = await resolveLivePlayerScreen(activeGameId, activeTeamId, gameState)
      if (active && next) setScreen(next)
    }

    async function loadGameState() {
      if (!navigator.onLine) {
        if (active) setScreen('reconnecting')
        return
      }
      const { data, error } = await supabase
        .from('games')
        .select('current_screen, answer_phase, question_stage, current_question_key, current_content_screen_key')
        .eq('id', activeGameId)
        .maybeSingle()
      if (error) {
        console.error('Could not load live game state:', error)
        if (active) setScreen('reconnecting')
        return
      }
      if (data) await applyGameState(data as RemoteGameState)
      else if (active) setScreen('game-ended')
    }

    void loadGameState()

    const channel = supabase
      .channel(`player-game-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, payload => {
        void applyGameState(payload.new as RemoteGameState)
      })
      .subscribe(status => {
        if (!active) return
        if (status === 'SUBSCRIBED') void loadGameState()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setScreen('reconnecting')
      })

    const handleOffline = () => { if (active) setScreen('reconnecting') }
    const handleOnline = () => { if (active) void loadGameState() }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    return () => {
      active = false
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      void supabase.removeChannel(channel)
    }
  }, [joined, setScreen])
}

function useLiveQuestionDefinition() {
  const [question, setQuestion] = useState<LiveQuestionDefinition | null>(null)

  useEffect(() => {
    const gameId = localStorage.getItem('simple-trivia-game-id')
    if (!gameId) return
    const activeGameId = gameId
    let active = true

    async function loadQuestion() {
      const { data: game } = await supabase.from('games').select('current_question_key').eq('id', activeGameId).maybeSingle()
      if (!active || !game?.current_question_key) return
      const { data, error } = await loadPlayerQuestion(activeGameId, game.current_question_key)
      if (!active) return
      if (error) return console.error('Could not load question:', error)
      setQuestion(data as LiveQuestionDefinition | null)
    }

    void loadQuestion()
    const channel = supabase
      .channel(`player-question-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => { void loadQuestion() })
      .subscribe()

    return () => { active = false; void supabase.removeChannel(channel) }
  }, [])

  return question
}

function useLiveContentScreenDefinition() {
  const [contentScreen, setContentScreen] = useState<LiveContentScreenDefinition | null>(null)

  useEffect(() => {
    const gameId = localStorage.getItem('simple-trivia-game-id')
    if (!gameId) return
    const activeGameId = gameId
    let active = true

    async function loadContentScreen() {
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('current_content_screen_key')
        .eq('id', activeGameId)
        .maybeSingle()

      if (!active) return
      if (gameError) return console.error('Could not load content-screen state:', gameError)
      if (!game?.current_content_screen_key) {
        setContentScreen(null)
        return
      }

      const { data, error } = await supabase
        .from('game_content_screens')
        .select('screen_key, item_position, round_number, round_title, title, body, image_url')
        .eq('game_id', activeGameId)
        .eq('screen_key', game.current_content_screen_key)
        .maybeSingle()

      if (!active) return
      if (error) return console.error('Could not load live content screen:', error)
      setContentScreen(data as LiveContentScreenDefinition | null)
    }

    void loadContentScreen()
    const channel = supabase
      .channel(`player-content-screen-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => { void loadContentScreen() })
      .subscribe()

    return () => { active = false; void supabase.removeChannel(channel) }
  }, [])

  return contentScreen
}

function useSubmitAnswer(go: (s: PlayerScreen) => void, expectedScreen: PlayerScreen) {
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function submit(value: string | string[]) {
    if (submitting) return
    const gameId = localStorage.getItem('simple-trivia-game-id')
    const teamId = localStorage.getItem('simple-trivia-team-id')
    if (!gameId || !teamId) return go('join')

    setSubmitting(true)
    setSubmitError(null)

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('current_screen, answer_phase, current_question_key')
      .eq('id', gameId)
      .maybeSingle()

    if (gameError || !game) {
      setSubmitError('Could not submit your answer. Please try again.')
      setSubmitting(false)
      return
    }

    if (game.current_screen !== expectedScreen || game.answer_phase !== 'open') {
      setSubmitting(false)
      go('no-answer')
      return
    }

    const answerText = Array.isArray(value) ? JSON.stringify(value.map(item => item.trim())) : value.trim()
    const { error } = await supabase.rpc('submit_player_answer', {
      p_game_id: gameId,
      p_team_id: teamId,
      p_answer_text: answerText,
    })

    if (error) {
      console.error('Could not submit answer:', error)
      setSubmitError('Could not submit your answer. Please try again.')
      setSubmitting(false)
      return
    }

    localStorage.setItem('simple-trivia-last-answer', answerText)
    go('submitted')
  }

  return { submit, submitting, submitError }
}

function useSubmitBonusAnswer(go: (s: PlayerScreen) => void) {
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function submit(value: string) {
    if (submitting) return
    const gameId = localStorage.getItem('simple-trivia-game-id')
    const teamId = localStorage.getItem('simple-trivia-team-id')
    if (!gameId || !teamId) return go('join')

    setSubmitting(true)
    setSubmitError(null)

    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('answer_phase, question_stage')
      .eq('id', gameId)
      .maybeSingle()

    if (gameError || !game || game.answer_phase !== 'open' || game.question_stage !== 'bonus') {
      setSubmitError('Bonus answers have closed.')
      setSubmitting(false)
      return
    }

    const answerText = value.trim()
    const { error } = await supabase.rpc('submit_player_bonus_answer', {
      p_game_id: gameId,
      p_team_id: teamId,
      p_answer_text: answerText,
    })

    if (error) {
      console.error('Could not submit bonus answer:', error)
      setSubmitError('Could not submit your bonus answer. Please try again.')
      setSubmitting(false)
      return
    }

    go('bonus-submitted')
  }

  return { submit, submitting, submitError }
}

type PlayerReviewStatus = 'correct' | 'incorrect' | 'review'

type PlayerReviewItem = {
  label?: string
  submitted: string
  expected?: string
  status: PlayerReviewStatus
}

type PlayerSnapshot = {
  teamName: string
  score: number
  answer: string
  rawAnswer: unknown
  hasSubmission: boolean
  isCorrect: boolean | null
  pointsAwarded: number
  pointsMax: number
  prompt: string
  correctAnswer: string
  roundLabel: string
  questionLabel: string
  questionType: PlayerScreen | null
  reviewItems: PlayerReviewItem[]
  missingAnswers: string[]
  prizeAwards: PrizeAward[]
  bonusAnswer: string
  hasBonusSubmission: boolean
  bonusCorrectAnswer: string
  bonusPointsAwarded: number
  bonusPointsMax: number
}

function playerReviewItemsFromJson(value: unknown): PlayerReviewItem[] {
  if (!value || typeof value !== 'object') return []
  const items = (value as { items?: unknown }).items
  if (!Array.isArray(items)) return []

  return items
    .filter(item => item && typeof item === 'object')
    .map((item, index) => {
      const raw = item as Record<string, unknown>
      const status: PlayerReviewStatus = raw.status === 'correct' || raw.status === 'review'
        ? raw.status
        : 'incorrect'

      return {
        label: raw.label === undefined ? String(index + 1) : String(raw.label),
        submitted: raw.submitted === undefined ? '' : String(raw.submitted),
        expected: raw.expected === undefined ? undefined : String(raw.expected),
        status,
      }
    })
}

function playerMissingAnswersFromJson(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const missing = (value as { missing?: unknown }).missing
  return Array.isArray(missing) ? missing.map(item => String(item)) : []
}

function isCompoundResultType(questionType: PlayerScreen | null) {
  return questionType === 'multi-answer' || questionType === 'multi-part' || questionType === 'ranking'
}

function PlayerAnswerBreakdown({ snapshot }: { snapshot: PlayerSnapshot }) {
  const items = snapshot.reviewItems
  if (!isCompoundResultType(snapshot.questionType) || items.length === 0) return null

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, width: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '13px 16px', borderBottom: `1px solid ${C.line}` }}>
        <p style={{ color: C.sub, fontSize: 12, fontWeight: 800, letterSpacing: '0.06em' }}>
          {playerResponseLabel(snapshot.questionType)}
        </p>
      </div>

      <div>
        {items.map((item, index) => {
          const correct = item.status === 'correct'
          const review = item.status === 'review'
          const label = snapshot.questionType === 'multi-part'
            ? (item.label ?? String.fromCharCode(65 + index))
            : snapshot.questionType === 'ranking'
              ? (item.label ?? String(index + 1))
              : null

          return (
            <div
              key={`${label ?? 'answer'}-${index}`}
              style={{
                borderBottom: index === items.length - 1 ? 'none' : `1px solid ${C.line}`,
                background: review ? C.cautionMist : 'transparent',
                padding: '14px 16px',
                display: 'grid',
                gridTemplateColumns: label ? '28px minmax(0, 1fr) 30px' : 'minmax(0, 1fr) 30px',
                alignItems: 'center',
                gap: 10,
              }}
            >
              {label && (
                <span
                  style={{
                    background: snapshot.questionType === 'multi-part' ? C.violetPale : C.ground,
                    color: snapshot.questionType === 'multi-part' ? C.violet : C.sub,
                    borderRadius: 999,
                    width: 26,
                    height: 26,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 900,
                  }}
                >
                  {label}
                </span>
              )}

              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    style={{
                      color: correct ? C.go : C.ink,
                      fontSize: 16,
                      fontWeight: 800,
                    }}
                    className="truncate"
                  >
                    {item.submitted || 'No answer'}
                  </span>
                  {snapshot.questionType !== 'multi-answer' && !correct && item.expected && (
                    <>
                      <span style={{ color: C.sub, fontSize: 12 }} className="shrink-0">→</span>
                      <span
                        style={{ color: C.go, fontSize: 14, fontWeight: 800 }}
                        className="truncate"
                        title={`Correct answer: ${item.expected}`}
                      >
                        {item.expected}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div
                style={{
                  background: correct ? C.goMist : review ? C.cautionMist : C.stopMist,
                  border: `1px solid ${correct ? C.goBorder : review ? C.cautionBorder : C.stopBorder}`,
                  color: correct ? C.go : review ? C.caution : C.stop,
                  borderRadius: 999,
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  fontWeight: 900,
                }}
              >
                {correct ? '✓' : review ? '?' : '×'}
              </div>
            </div>
          )
        })}

        {snapshot.questionType === 'multi-answer' && snapshot.missingAnswers.length > 0 && (
          <div
            style={{
              borderTop: `1px solid ${C.line}`,
              background: C.goMist,
              padding: '13px 16px',
            }}
          >
            <p style={{ color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', marginBottom: 5 }}>
              {snapshot.missingAnswers.length === 1 ? 'MISSING CORRECT ANSWER' : 'MISSING CORRECT ANSWERS'}
            </p>
            <div className="flex flex-col gap-1">
              {snapshot.missingAnswers.map((answer) => (
                <span key={answer} style={{ color: C.go, fontSize: 15, fontWeight: 800 }}>
                  {answer}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PlayerSimpleAnswerResult({ snapshot }: { snapshot: PlayerSnapshot }) {
  const correct = snapshot.pointsAwarded > 0 && snapshot.pointsAwarded >= snapshot.pointsMax
  const hasCorrection = !correct && snapshot.correctAnswer && snapshot.correctAnswer !== '—'

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, width: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '13px 16px', borderBottom: `1px solid ${C.line}` }}>
        <p style={{ color: C.sub, fontSize: 12, fontWeight: 800, letterSpacing: '0.06em' }}>
          {playerResponseLabel(snapshot.questionType)}
        </p>
      </div>

      <div
        style={{
          padding: '15px 16px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 30px',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div className="min-w-0 flex items-center gap-2">
          <span
            style={{ color: correct ? C.go : C.ink, fontSize: 17, fontWeight: 800 }}
            className="truncate"
          >
            {snapshot.answer || 'No answer'}
          </span>

          {hasCorrection && (
            <>
              <span style={{ color: C.sub, fontSize: 12 }} className="shrink-0">→</span>
              <span
                style={{ color: C.go, fontSize: 15, fontWeight: 800 }}
                className="truncate"
                title={`Correct answer: ${snapshot.correctAnswer}`}
              >
                {snapshot.correctAnswer}
              </span>
            </>
          )}
        </div>

        <div
          style={{
            background: correct ? C.goMist : C.stopMist,
            border: `1px solid ${correct ? C.goBorder : C.stopBorder}`,
            color: correct ? C.go : C.stop,
            borderRadius: 999,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 900,
          }}
        >
          {correct ? '✓' : '×'}
        </div>
      </div>
    </div>
  )
}

function PlayerBonusResult({ snapshot }: { snapshot: PlayerSnapshot }) {
  if (snapshot.bonusPointsMax <= 0) return null
  const correct = snapshot.bonusPointsAwarded > 0
  return (
    <div style={{ background: correct ? C.goMist : C.panel, border: `1px solid ${correct ? C.goBorder : C.line}`, borderRadius: 18, width: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${correct ? C.goBorder : C.line}` }}>
        <p style={{ color: C.violet, fontSize: 11, fontWeight: 900, letterSpacing: '0.08em' }}>BONUS · {snapshot.bonusPointsMax} {snapshot.bonusPointsMax === 1 ? 'POINT' : 'POINTS'}</p>
      </div>
      <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 30px', gap: 10, alignItems: 'center' }}>
        <div className="min-w-0 flex items-center gap-2">
          <span style={{ color: correct ? C.go : C.ink, fontSize: 16, fontWeight: 800 }} className="truncate">{snapshot.bonusAnswer || 'No answer'}</span>
          {!correct && snapshot.bonusCorrectAnswer && (
            <><span style={{ color: C.sub }}>→</span><span style={{ color: C.go, fontSize: 14, fontWeight: 800 }} className="truncate">{snapshot.bonusCorrectAnswer}</span></>
          )}
        </div>
        <div style={{ background: correct ? C.goMist : C.stopMist, border: `1px solid ${correct ? C.goBorder : C.stopBorder}`, color: correct ? C.go : C.stop, borderRadius: 999, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
          {correct ? '✓' : '×'}
        </div>
      </div>
    </div>
  )
}

function PlayerQuestionResultSummary({ snapshot }: { snapshot: PlayerSnapshot }) {
  const hasBonus = snapshot.bonusPointsMax > 0
  const totalAwarded = snapshot.pointsAwarded + snapshot.bonusPointsAwarded
  const pointLabel = (points: number) => `${points} ${points === 1 ? 'point' : 'points'}`

  return (
    <>
      <div className="w-full space-y-2">
        {isCompoundResultType(snapshot.questionType) && snapshot.reviewItems.length > 0 ? (
          <PlayerAnswerBreakdown snapshot={snapshot} />
        ) : (
          <PlayerSimpleAnswerResult snapshot={snapshot} />
        )}
        <PlayerBonusResult snapshot={snapshot} />
      </div>

      <section style={{ background: C.panel, border: `1px solid ${C.line}` }} className="w-full overflow-hidden rounded-2xl">
        {hasBonus ? (
          <>
            <div className="grid grid-cols-2">
              <div className="px-4 py-3 text-center" style={{ borderLeft: `1px solid ${C.line}` }}>
                <p style={{ color: C.sub }} className="text-[10px] font-black uppercase tracking-[0.1em]">Main</p>
                <p style={{ color: snapshot.pointsAwarded > 0 ? C.go : C.sub }} className="mt-1 text-lg font-black">+{pointLabel(snapshot.pointsAwarded)}</p>
              </div>
              <div className="px-4 py-3 text-center">
                <p style={{ color: C.violet }} className="text-[10px] font-black uppercase tracking-[0.1em]">Bonus</p>
                <p style={{ color: snapshot.bonusPointsAwarded > 0 ? C.go : C.sub }} className="mt-1 text-lg font-black">+{pointLabel(snapshot.bonusPointsAwarded)}</p>
              </div>
            </div>
            <div style={{ background: totalAwarded > 0 ? C.goMist : C.ground, borderTop: `1px solid ${totalAwarded > 0 ? C.goBorder : C.line}` }} className="px-4 py-3 text-center">
              <p style={{ color: totalAwarded > 0 ? C.go : C.sub }} className="text-xl font-black">+{pointLabel(totalAwarded)} this question</p>
            </div>
          </>
        ) : (
          <div style={{ background: snapshot.pointsAwarded > 0 ? C.goMist : C.ground }} className="px-4 py-3 text-center">
            <p style={{ color: snapshot.pointsAwarded > 0 ? C.go : C.sub }} className="text-xl font-black">+{pointLabel(snapshot.pointsAwarded)}</p>
          </div>
        )}
      </section>
    </>
  )
}

function usePlayerSnapshot(): PlayerSnapshot {
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>({
    teamName: '', score: 0, answer: '', rawAnswer: null, hasSubmission: false,
    isCorrect: null, pointsAwarded: 0, pointsMax: 1,
    prompt: '', correctAnswer: '—', roundLabel: '', questionLabel: '', questionType: null,
    reviewItems: [], missingAnswers: [], prizeAwards: [], bonusAnswer: '', hasBonusSubmission: false, bonusCorrectAnswer: '',
    bonusPointsAwarded: 0, bonusPointsMax: 0,
  })

  useEffect(() => {
    const gameId = localStorage.getItem('simple-trivia-game-id')
    const teamId = localStorage.getItem('simple-trivia-team-id')
    const fallbackName = localStorage.getItem('simple-trivia-team-name') ?? ''
    if (!gameId || !teamId) return
    const activeGameId = gameId
    const activeTeamId = teamId
    let active = true

    async function loadSnapshot() {
      const [{ data: team }, { data: game }] = await Promise.all([
        supabase.from('teams').select('name, score, prize_awards').eq('id', activeTeamId).maybeSingle(),
        supabase.from('games').select('current_question_key').eq('id', activeGameId).maybeSingle(),
      ])
      if (!active) return

      let question: LiveQuestionDefinition | null = null
      let submission: { answer_text: string; is_correct: boolean | null; points_awarded: number; grading_json: unknown } | null = null
      let bonusSubmission: { answer_text: string; is_correct: boolean | null; points_awarded: number; grading_json: unknown } | null = null

      if (game?.current_question_key) {
        const [{ data: questionRow }, { data: submissionRow }, { data: bonusSubmissionRow }] = await Promise.all([
          loadPlayerQuestion(activeGameId, game.current_question_key),
          supabase
            .from('submissions')
            .select('answer_text, is_correct, points_awarded, grading_json')
            .eq('game_id', activeGameId)
            .eq('team_id', activeTeamId)
            .eq('question_key', game.current_question_key)
            .maybeSingle(),
          supabase
            .rpc('get_player_bonus_submission', {
              p_game_id: activeGameId,
              p_team_id: activeTeamId,
              p_question_key: game.current_question_key,
            })
            .maybeSingle(),
        ])
        question = questionRow as LiveQuestionDefinition | null
        submission = submissionRow
        bonusSubmission = bonusSubmissionRow
      }

      if (!active) return

      const reviewItems = playerReviewItemsFromJson(submission?.grading_json)
      const missingAnswers = playerMissingAnswersFromJson(submission?.grading_json)
      const revealedBonus = runtimeBonusFromJson(question?.bonus)

      setSnapshot({
        teamName: team?.name ?? fallbackName,
        score: team?.score ?? 0,
        answer: submission ? submittedAnswerLabel(submission.answer_text, question) : '',
        rawAnswer: submission ? parseStoredAnswer(submission.answer_text) : null,
        hasSubmission: Boolean(submission),
        isCorrect: submission?.is_correct ?? null,
        pointsAwarded: submission?.points_awarded ?? 0,
        pointsMax: question?.points_max ?? 1,
        prompt: question?.prompt ?? '',
        correctAnswer: correctAnswerLabel(question),
        roundLabel: question ? `Round ${question.round_number}` : '',
        questionLabel: question ? `Question ${question.round_position} of ${question.round_question_count}` : '',
        questionType: question?.question_type ?? null,
        reviewItems,
        missingAnswers,
        prizeAwards: prizeAwardsFromJson(team?.prize_awards),
        bonusAnswer: bonusSubmission?.answer_text ?? '',
        hasBonusSubmission: Boolean(bonusSubmission),
        bonusCorrectAnswer: revealedBonus?.correctAnswer ?? '',
        bonusPointsAwarded: bonusSubmission?.points_awarded ?? 0,
        bonusPointsMax: revealedBonus?.points ?? playerBonusFromJson(question?.bonus)?.points ?? 0,
      })
    }

    void loadSnapshot()
    const channel = supabase
      .channel(`player-snapshot-${teamId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams', filter: `id=eq.${teamId}` }, () => { void loadSnapshot() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions', filter: `team_id=eq.${teamId}` }, () => { void loadSnapshot() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => { void loadSnapshot() })
      .subscribe()

    return () => { active = false; void supabase.removeChannel(channel) }
  }, [])

  return snapshot
}

function playerResponseLabel(questionType: PlayerScreen | null) {
  if (questionType === 'ranking') return 'YOUR ORDER'
  if (questionType === 'multi-answer' || questionType === 'multi-part') return 'YOUR ANSWERS'
  return 'YOUR ANSWER'
}

function useLeaderboardVisibility() {
  const [visibility, setVisibility] = useState<LeaderboardVisibility | null>(null)

  useEffect(() => {
    const gameId = localStorage.getItem('simple-trivia-game-id')
    if (!gameId) return
    const activeGameId = gameId
    let active = true

    async function load() {
      const { data } = await supabase.from('games').select('settings').eq('id', activeGameId).maybeSingle()
      if (active) setVisibility(leaderboardVisibilityFromSettings(data?.settings))
    }

    void load()
    return () => { active = false }
  }, [])

  return visibility
}

function useAnswerRevealMode() {
  const [mode, setMode] = useState<AnswerRevealMode | null>(null)

  useEffect(() => {
    const gameId = localStorage.getItem('simple-trivia-game-id')
    if (!gameId) return
    const activeGameId = gameId
    let active = true

    async function load() {
      const { data } = await supabase.from('games').select('settings').eq('id', activeGameId).maybeSingle()
      if (active) setMode(answerRevealModeFromSettings(data?.settings))
    }

    void load()
    return () => { active = false }
  }, [])

  return mode
}

function useLiveLeaderboard(enabled = true) {
  const [teams, setTeams] = useState<PlayerLeaderboardTeam[]>([])
  const [teamId, setTeamId] = useState('')

  useEffect(() => {
    const gameId = localStorage.getItem('simple-trivia-game-id')
    const storedTeamId = localStorage.getItem('simple-trivia-team-id') ?? ''
    // Restore this browser-owned identity after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTeamId(storedTeamId)
    if (!gameId || !enabled) return
    const activeGameId = gameId
    let active = true

    async function load() {
      const { data } = await supabase.from('teams').select('id, name, score, final_placement, final_sort_order').eq('game_id', activeGameId).order('score', { ascending: false })
      if (active) setTeams((data ?? []) as PlayerLeaderboardTeam[])
    }
    void load()
    const channel = supabase
      .channel(`player-leaderboard-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${gameId}` }, () => { void load() })
      .subscribe()
    return () => { active = false; void supabase.removeChannel(channel) }
  }, [enabled])

  return {
    teams: [...teams].sort((a, b) => {
      if (a.final_sort_order !== null && b.final_sort_order !== null) return a.final_sort_order - b.final_sort_order
      return b.score - a.score || a.name.localeCompare(b.name)
    }),
    teamId,
  }
}

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const C = {
  violet: '#7C3AED',
  violetHover: '#6D28D9',
  violetMist: '#F5F3FF',
  violetPale: '#EDE9FE',
  ground: '#F6F5FC',
  panel: '#FFFFFF',
  line: '#E8E5F4',
  ink: '#18171F',
  sub: '#4E4B63',
  go: '#059669',
  goMist: '#ECFDF5',
  goBorder: '#A7F3D0',
  stop: '#DC2626',
  stopMist: '#FEF2F2',
  stopBorder: '#FECACA',
  caution: '#D97706',
  cautionMist: '#FFFBEB',
  cautionBorder: '#FDE68A',
}

// ─── SCREEN MANIFEST (prototype navigator) ────────────────────────────────────
const SCREENS: { id: PlayerScreen; label: string }[] = [
  { id: 'join',           label: '1 · Join Game' },
  { id: 'team-setup',     label: '2 · Team Setup' },
  { id: 'waiting',        label: '3 · Waiting' },
  { id: 'round-start',    label: '4 · Round Start' },
  { id: 'single-answer',  label: '5 · Single Answer' },
  { id: 'image-question', label: '6 · Image Question' },
  { id: 'multiple-choice',label: '7 · Multiple Choice' },
  { id: 'multi-answer',   label: '8 · Multi-Answer' },
  { id: 'multi-part',     label: '9 · Multi-Part' },
  { id: 'ranking',        label: '10 · Ranking' },
  { id: 'bonus-answer',   label: '10b · Bonus Answer' },
  { id: 'bonus-submitted',label: '10c · Bonus Submitted' },
  { id: 'submitted',      label: '11 · Submitted' },
  { id: 'no-answer',      label: '12 · No Answer' },
  { id: 'correct',        label: '13 · Correct' },
  { id: 'incorrect',      label: '14 · Incorrect' },
  { id: 'partial-correct',       label: '13b · Partial Credit' },
  { id: 'content-screen',        label: '15 · Content Screen' },
  { id: 'intermission',          label: '16 · Intermission' },
  { id: 'question-results',      label: '16b · Question Results' },
  { id: 'round-results',         label: '17 · Round Results' },
  { id: 'round-results-hidden',  label: '17b · Results (Hidden LB)' },
  { id: 'delayed-reveal', label: '18 · Delayed Reveal' },
  { id: 'winner',         label: '19 · Winner' },
  { id: 'final-result',   label: '20 · Final Result' },
  { id: 'tiebreaker-pending', label: '20a · Tie Decision' },
  { id: 'tiebreaker',     label: '20b · Tiebreaker' },
  { id: 'tiebreaker-result', label: '20c · Tiebreak Result' },
  { id: 'reconnecting',   label: '21 · Reconnecting' },
  { id: 'game-ended',     label: '22 · Game Ended' },
]

// Demo flow — primary interactive path through the prototype
const DEMO_FLOW: PlayerScreen[] = [
  'join', 'team-setup', 'waiting', 'round-start',
  'single-answer', 'submitted', 'correct',
  'single-answer', 'round-results', 'intermission', 'final-result',
]

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────

function TopBar({
  team, score, round, question,
}: {
  team?: string; score?: number; round?: string; question?: string
}) {
  const answerRevealMode = useAnswerRevealMode()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  const showScore = scoresVisible && score !== undefined && answerRevealMode === 'each'

  return (
    <header style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }} className="shrink-0 px-4 py-2.5">
      {(round || question || team) && (
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {round && <span style={{ color: C.sub, fontSize: 12 }} className="truncate font-medium">{round}</span>}
            {round && question && <span style={{ color: C.line, fontSize: 12 }}>·</span>}
            {question && <span style={{ color: C.sub, fontSize: 12 }} className="truncate font-medium">{question}</span>}
          </div>
          {team && (
            <div className="shrink-0 text-right">
              <div style={{ color: C.ink, fontSize: 13 }} className="font-bold leading-tight">{team}</div>
              {showScore && (
                <div style={{ color: C.violet, fontSize: 12 }} className="font-bold">{score} pts</div>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  )
}

function PlayerPrimaryHeader({ onLeave }: { onLeave: () => void }) {
  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }} className="flex shrink-0 items-center justify-between px-4 py-2">
      <div className="flex items-center gap-2">
        <div style={{ background: C.violet, borderRadius: 8 }} className="flex h-7 w-7 shrink-0 items-center justify-center">
          <span className="font-black text-white" style={{ fontSize: 11 }}>ST</span>
        </div>
        <span style={{ color: C.sub, fontSize: 14 }} className="font-semibold">Simple Trivia</span>
      </div>
      <button
        type="button"
        onClick={onLeave}
        style={{ color: C.sub }}
        className="rounded-lg px-2 py-1 text-xs font-bold transition-colors hover:bg-red-50 hover:text-red-700"
      >
        Leave game
      </button>
    </div>
  )
}

function PlayerQuestionCard({
  prompt,
  eyebrow,
  tone = 'question',
}: {
  prompt: string
  eyebrow?: string
  tone?: 'question' | 'bonus'
}) {
  const bonus = tone === 'bonus'
  return (
    <section
      style={{
        background: bonus ? C.violetPale : C.panel,
        border: `1px solid ${bonus ? '#C4B5FD' : C.line}`,
        borderLeft: `4px solid ${C.violet}`,
        borderRadius: 18,
        boxShadow: '0 8px 24px rgba(44, 37, 80, 0.06)',
        padding: '17px 18px 18px',
      }}
      className="mb-5 text-left"
    >
      {eyebrow && (
        <p style={{ color: C.violet }} className="mb-2 text-[10px] font-black uppercase tracking-[0.13em]">
          {eyebrow}
        </p>
      )}
      <h2 style={{ color: C.ink, fontSize: 'clamp(22px, 6vw, 27px)', lineHeight: 1.3, fontWeight: 900 }}>
        {prompt}
      </h2>
    </section>
  )
}

function WaitingDots() {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="dot-pulse"
          style={{
            background: C.violet,
            borderRadius: '50%',
            width: 8, height: 8,
            animationDelay: `${i * 0.22}s`,
          }}
        />
      ))}
    </div>
  )
}

function WaitMsg({ msg }: { msg: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <WaitingDots />
      <p style={{ color: C.sub, fontSize: 15 }} className="text-center">{msg}</p>
    </div>
  )
}

function StickyBottom({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, borderTop: `1px solid ${C.line}` }}
      className="sticky bottom-0 px-4 py-3 shrink-0">
      {children}
    </div>
  )
}

function Btn({
  children, onClick, disabled = false, variant = 'primary',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost'
}) {
  const bg = variant === 'ghost'
    ? 'transparent'
    : disabled ? C.line : C.violet
  const color = variant === 'ghost'
    ? C.sub
    : disabled ? C.sub : '#fff'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bg,
        color,
        borderRadius: 14,
        border: variant === 'ghost' ? `1px solid ${C.line}` : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.12s',
        width: '100%',
        padding: '15px 12px',
        fontSize: 16,
        fontWeight: 700,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

function HostAdvance({ label, to, go }: { label: string; to: PlayerScreen; go: (s: PlayerScreen) => void }) {
  const enabled = useContext(PlayerDevControlsContext)
  if (!enabled) return null

  return (
    <button
      onClick={() => go(to)}
      style={{
        color: C.sub,
        fontSize: 11,
        fontFamily: 'inherit',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        textDecoration: 'underline',
        padding: '8px 0',
      }}
    >
      ↓ prototype: {label}
    </button>
  )
}

// ─── SCREEN 1 — JOIN GAME ─────────────────────────────────────────────────────
export function JoinGame({ go }: { go: (s: PlayerScreen) => void }) {
  const [code, setCode] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [joining, setJoining] = useState(false)
  const handledQrCode = useRef(false)

  const handleJoin = useCallback(async (selectedCode = code) => {
    setInvalid(false)
    setJoining(true)

    const { data: game, error } = await supabase
      .from('games')
      .select('id, code, title, status')
      .eq('code', selectedCode)
      .in('status', [...JOINABLE_GAME_STATUSES])
      .maybeSingle()

    if (error) {
      console.error('Error finding game:', error)
      setInvalid(true)
      setJoining(false)
      return
    }

    if (!game) {
      setInvalid(true)
      setJoining(false)
      return
    }

    localStorage.setItem('simple-trivia-game-id', game.id)
    localStorage.setItem('simple-trivia-game-code', game.code)
    localStorage.setItem('simple-trivia-game-title', game.title)

    go('team-setup')
  }, [code, go])

  useEffect(() => {
    if (handledQrCode.current) return

    const qrCode = gameCodeFromSearch(window.location.search)
    if (!qrCode) return

    const timer = window.setTimeout(() => {
      if (handledQrCode.current) return
      handledQrCode.current = true
      setCode(qrCode)
      void handleJoin(qrCode)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [handleJoin])

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div className="flex-1 flex flex-col items-center justify-center px-7 py-14">
        <div style={{ background: C.violet, borderRadius: 20, width: 64, height: 64 }}
          className="flex items-center justify-center mb-8 shrink-0">
          <span className="text-white font-black text-2xl">ST</span>
        </div>

        <h1 style={{ color: C.ink, fontSize: 30 }} className="font-black text-center mb-2">
          Join a Game
        </h1>
        <p style={{ color: C.sub, fontSize: 15 }} className="text-center mb-10 leading-relaxed">
          Enter the game code shown by your quiz host.
        </p>

        <div style={{ width: '100%', maxWidth: 300 }}>
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setInvalid(false) }}
            placeholder="000000"
            className="placeholder:text-zinc-300"
            style={{
              border: `2px solid ${invalid ? C.stop : code.length === 6 ? C.violet : C.line}`,
              borderRadius: 18,
              background: C.panel,
              color: C.ink,
              fontSize: 38,
              fontWeight: 800,
              letterSpacing: '0.18em',
              textAlign: 'center',
              outline: 'none',
              width: '100%',
              padding: '18px 12px',
              fontFamily: 'inherit',
              transition: 'border-color 0.14s',
            }}
          />

          {invalid && (
            <div style={{
              background: C.stopMist,
              borderRadius: 14,
              border: `1px solid ${C.stopBorder}`,
              marginTop: 12,
            }} className="px-4 py-3">
              <p style={{ color: C.stop, fontSize: 14, fontWeight: 600 }} className="text-center">
                We couldn’t find that game.
              </p>
              <p style={{ color: C.stop, fontSize: 13, opacity: 0.8 }} className="text-center">
                Check the code and try again.
              </p>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Btn onClick={() => { void handleJoin() }} disabled={code.length < 6 || joining}>{joining ? 'Joining…' : 'Join Game'}</Btn>
          </div>

          <p style={{ color: C.sub, fontSize: 12, marginTop: 12 }} className="text-center">
            Or scan your host’s QR code to join instantly.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 2 — TEAM SETUP ────────────────────────────────────────────────────
type PinMode = 'none' | 'have' | 'create'

function TeamSetup({ go }: { go: (s: PlayerScreen) => void }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pinMode, setPinMode] = useState<PinMode>('none')
  const [taken, setTaken] = useState(false)
  const [joining, setJoining] = useState(false)
  const [gameTitle, setGameTitle] = useState('Trivia game')

  useEffect(() => {
    const storedTitle = localStorage.getItem('simple-trivia-game-title')
    // Restore the selected game's real title after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (storedTitle) setGameTitle(storedTitle)
  }, [])

async function handleJoin() {
  if (!name.trim() || joining) return;
  setTaken(false);
  setJoining(true);

  const gameId = localStorage.getItem("simple-trivia-game-id");

  if (!gameId) {
    setJoining(false);
    go("join");
    return;
  }

  const { data: team, error } = await supabase
    .rpc("join_live_game", {
      p_game_id: gameId,
      p_team_name: name.trim(),
    })
    .single();

  if (error) {
    console.error("Error creating team:", error);

    if (error.code === "23505") {
      setTaken(true);
    }

    setJoining(false);
    return;
  }

  localStorage.setItem("simple-trivia-team-id", team.id);
  localStorage.setItem("simple-trivia-team-name", team.name);

  go("waiting");
}

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }} className="px-5 pt-5 pb-4 shrink-0">
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: C.goMist, borderRadius: 10, padding: '5px 10px',
          marginBottom: 10,
        }}>
          <span style={{ color: C.go, fontSize: 10 }}>●</span>
          <span style={{ color: C.go, fontSize: 13, fontWeight: 700 }}>Game found</span>
        </div>
        <h2 style={{ color: C.ink, fontSize: 20 }} className="font-black">{gameTitle}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h3 style={{ color: C.ink, fontSize: 24 }} className="font-black mb-1">What’s your team name?</h3>
        <p style={{ color: C.sub, fontSize: 15, marginBottom: 20 }}>
          This is what you’ll appear as on the leaderboard.
        </p>

        <input
          type="text"
          enterKeyHint="go"
          value={name}
          onChange={e => { setName(e.target.value); setTaken(false) }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || !name.trim() || joining) return
            event.preventDefault()
            void handleJoin()
          }}
          placeholder="Trivia Newton John"
          style={{
            border: `2px solid ${taken ? C.stop : name ? C.violet : C.line}`,
            borderRadius: 14,
            background: C.panel,
            color: C.ink,
            fontSize: 18,
            fontWeight: 600,
            outline: 'none',
            width: '100%',
            padding: '14px 16px',
            fontFamily: 'inherit',
            transition: 'border-color 0.14s',
          }}
        />

        {taken && (
          <div style={{
            background: C.stopMist,
            borderRadius: 12,
            border: `1px solid ${C.stopBorder}`,
            marginTop: 10, padding: '12px 16px',
          }}>
            <p style={{ color: C.stop, fontSize: 14, fontWeight: 600 }}>
              That team name is already being used in this game.
            </p>
            <p style={{ color: C.stop, fontSize: 14, marginTop: 2 }}>Try another name.</p>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Btn onClick={() => { void handleJoin() }} disabled={!name.trim() || joining}>
            {joining ? 'Joining…' : 'Join Game'}
          </Btn>
          <p style={{ color: C.sub, fontSize: 12, marginTop: 7 }} className="text-center">
            One phone per team. You can also press Go on your keyboard.
          </p>
        </div>

        {/* ── Team PIN section ── */}
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 28, paddingTop: 22 }}>
          <p style={{ color: C.ink, fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            Team PIN
            <span style={{ color: C.sub, fontSize: 13, fontWeight: 500, marginLeft: 8 }}>optional</span>
          </p>
          <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, marginBottom: 16 }}>
            A team PIN links your results across multiple trivia nights so you can build a history and compete in tournaments.
          </p>

          {/* Path selector — always visible */}
          {pinMode === 'none' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => setPinMode('have')}
                style={{
                  background: C.panel,
                  border: `2px solid ${C.line}`,
                  borderRadius: 14,
                  padding: '14px 18px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <span style={{ fontSize: 22, flexShrink: 0 }}>🔑</span>
                <span>
                  <span style={{ color: C.ink, fontSize: 15, fontWeight: 700, display: 'block' }}>
                    I already have a team PIN
                  </span>
                  <span style={{ color: C.sub, fontSize: 13 }}>Enter it to link tonight’s result</span>
                </span>
              </button>
              <button
                onClick={() => setPinMode('create')}
                style={{
                  background: C.panel,
                  border: `2px solid ${C.line}`,
                  borderRadius: 14,
                  padding: '14px 18px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <span style={{ fontSize: 22, flexShrink: 0 }}>✨</span>
                <span>
                  <span style={{ color: C.ink, fontSize: 15, fontWeight: 700, display: 'block' }}>
                    Create a team PIN
                  </span>
                  <span style={{ color: C.sub, fontSize: 13 }}>Start building your team history tonight</span>
                </span>
              </button>
              <button
                onClick={() => { void handleJoin() }}
                disabled={!name.trim() || joining}
                style={{ color: C.sub, fontSize: 14, background: 'none', border: 'none', cursor: !name.trim() || joining ? 'not-allowed' : 'pointer', opacity: !name.trim() || joining ? 0.45 : 1, fontFamily: 'inherit', padding: '6px 0', textAlign: 'left' }}
              >
                {joining ? 'Joining…' : 'Skip for now →'}
              </button>
            </div>
          )}

          {/* Path A — enter existing PIN */}
          {pinMode === 'have' && (
            <div>
              <label style={{ color: C.sub, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>
                Your team PIN
              </label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 4821"
                style={{
                  border: `2px solid ${pin.length === 4 ? C.violet : C.line}`,
                  borderRadius: 14,
                  background: C.panel,
                  color: C.ink,
                  fontSize: 28,
                  fontWeight: 800,
                  outline: 'none',
                  width: '100%',
                  padding: '14px 16px',
                  letterSpacing: '0.3em',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.14s',
                }}
              />
              <button
                onClick={() => { setPin(''); setPinMode('none') }}
                style={{ color: C.sub, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginTop: 10, textDecoration: 'underline' }}
              >
                ← Back
              </button>
            </div>
          )}

          {/* Path B — create a new PIN */}
          {pinMode === 'create' && (
            <div>
              <label style={{ color: C.sub, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 8 }}>
                Choose a 4-digit PIN
              </label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 4821"
                style={{
                  border: `2px solid ${pin.length === 4 ? C.violet : C.line}`,
                  borderRadius: 14,
                  background: C.panel,
                  color: C.ink,
                  fontSize: 28,
                  fontWeight: 800,
                  outline: 'none',
                  width: '100%',
                  padding: '14px 16px',
                  letterSpacing: '0.3em',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.14s',
                }}
              />
              <div style={{ background: C.violetMist, borderRadius: 12, padding: '10px 14px', marginTop: 10 }}>
                <p style={{ color: C.sub, fontSize: 13, lineHeight: 1.5 }}>
                  Remember this PIN — you’ll use it at your next trivia night to pick up where you left off.
                </p>
              </div>
              <button
                onClick={() => { setPin(''); setPinMode('none') }}
                style={{ color: C.sub, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginTop: 10, textDecoration: 'underline' }}
              >
                ← Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 3 — WAITING ───────────────────────────────────────────────────────
function Waiting({ go }: { go: (s: PlayerScreen) => void }) {
  const [teamName, setTeamName] = useState('Your team')
  const [gameTitle, setGameTitle] = useState('Friday Night Trivia')
  const [gameCode, setGameCode] = useState('')
  const [teamCount, setTeamCount] = useState<number | null>(null)

  useEffect(() => {
    const gameId = localStorage.getItem('simple-trivia-game-id')
    const storedTeamName = localStorage.getItem('simple-trivia-team-name')
    const storedGameTitle = localStorage.getItem('simple-trivia-game-title')
    const storedGameCode = localStorage.getItem('simple-trivia-game-code')

    // Restore browser-owned lobby details after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (storedTeamName) setTeamName(storedTeamName)
    if (storedGameTitle) setGameTitle(storedGameTitle)
    if (storedGameCode) setGameCode(storedGameCode)

    if (!gameId) return
    const activeGameId = gameId

    let active = true

    async function loadTeamCount() {
      const { count, error } = await supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('game_id', activeGameId)

      if (!active) return

      if (error) {
        console.error('Could not load team count:', error)
        return
      }

      setTeamCount(count ?? 0)
    }

    void loadTeamCount()

    const channel = supabase
      .channel(`waiting-teams-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'teams',
          filter: `game_id=eq.${gameId}`,
        },
        () => { void loadTeamCount() },
      )
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [])

  const formattedCode = gameCode.length === 6
    ? `${gameCode.slice(0, 3)} ${gameCode.slice(3)}`
    : gameCode

  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center" style={{ minHeight: '100%' }}>
      <div style={{ background: C.goMist, borderRadius: 999, border: `2px solid ${C.goBorder}`, width: 64, height: 64 }}
        className="flex items-center justify-center mb-6 shrink-0">
        <span style={{ fontSize: 28, color: C.go }}>✓</span>
      </div>

      <h1 style={{ color: C.ink, fontSize: 32 }} className="font-black mb-2">You’re in!</h1>

      <div style={{ background: C.violetPale, borderRadius: 18, width: '100%', maxWidth: 300, padding: '18px 24px', marginTop: 8, marginBottom: 24 }}>
        <p style={{ color: C.violet, fontSize: 20 }} className="font-black mb-1">{teamName}</p>
        <p style={{ color: C.sub, fontSize: 14 }}>{gameTitle}</p>
      </div>

      <WaitMsg msg="Waiting for the host to start the quiz…" />

      <p style={{ color: C.sub, fontSize: 13, marginTop: 16 }}>
        {teamCount === null ? 'Loading teams…' : `${teamCount} ${teamCount === 1 ? 'team' : 'teams'} joined`}
      </p>

      {gameCode && (
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 20, marginTop: 28, width: '100%', maxWidth: 260 }}>
          <p style={{ color: C.sub, fontSize: 12 }}>
            Game code{' '}
            <span style={{ color: C.ink, fontWeight: 800, letterSpacing: '0.15em' }}>{formattedCode}</span>
          </p>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <HostAdvance label="host starts game" to="round-start" go={go} />
      </div>
    </div>
  )
}

// ─── SCREEN 4 — ROUND START ───────────────────────────────────────────────────
function RoundStart() {
  const question = useLiveQuestionDefinition()

  if (!question) {
    return (
      <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
        <WaitMsg msg="Loading round…" />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
      <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 20 }}>Starting now</p>
      <p style={{ color: C.violet, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Round {question.round_number}</p>
      <h1 style={{ color: C.ink, fontSize: 42 }} className="font-black mb-2">{question.round_title}</h1>
      <p style={{ color: C.sub, fontSize: 16, marginBottom: 40 }}>{question.round_question_count} questions</p>
      <WaitMsg msg="Waiting for the first question…" />
    </div>
  )
}

// ─── SCREEN 5 — SINGLE ANSWER ─────────────────────────────────────────────────
function SingleAnswer({ go }: { go: (s: PlayerScreen) => void }) {
  const [answer, setAnswer] = useState('')
  const question = useLiveQuestionDefinition()
  const snapshot = usePlayerSnapshot()
  const { submit, submitting, submitError } = useSubmitAnswer(go, 'single-answer')
  const storedAnswer = typeof snapshot.rawAnswer === 'string' ? snapshot.rawAnswer : ''

  useEffect(() => {
    // Restore the team's previous response when the host reopens answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnswer(storedAnswer)
  }, [question?.question_key, storedAnswer])

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score}
        round={question ? `Round ${question.round_number}` : ''}
        question={question ? `Question ${question.round_position} of ${question.round_question_count}` : ''} />
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <PlayerQuestionCard prompt={question?.prompt ?? 'Loading question…'} eyebrow={question?.category ?? 'Question'} />
        <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>Your answer</label>
        <textarea rows={3} value={answer} onChange={e => setAnswer(e.target.value)} onKeyDown={event => submitPlayerAnswerOnEnter(event, Boolean(answer.trim()) && !submitting, () => { void submit(answer) })} placeholder="Type your answer…"
          style={{ border: `2px solid ${answer ? C.violet : C.line}`, borderRadius: 14, background: C.panel, color: C.ink, fontSize: 18, fontWeight: 500, outline: 'none', width: '100%', padding: '14px 16px', resize: 'none', fontFamily: 'inherit' }} />
        {submitError && <p style={{ color: C.stop, fontSize: 13, marginTop: 10 }}>{submitError}</p>}
      </div>
      <StickyBottom><Btn onClick={() => void submit(answer)} disabled={!answer.trim() || submitting}>{submitting ? 'Submitting…' : snapshot.hasSubmission ? 'Update Answer' : 'Submit Answer'}</Btn></StickyBottom>
    </div>
  )
}

// ─── SCREEN 6 — IMAGE QUESTION ────────────────────────────────────────────────
function ImageQuestion({ go }: { go: (s: PlayerScreen) => void }) {
  const [answer, setAnswer] = useState('')
  const question = useLiveQuestionDefinition()
  const snapshot = usePlayerSnapshot()
  const { submit, submitting, submitError } = useSubmitAnswer(go, 'image-question')
  const storedAnswer = typeof snapshot.rawAnswer === 'string' ? snapshot.rawAnswer : ''

  useEffect(() => {
    // Restore the team's previous response when the host reopens answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnswer(storedAnswer)
  }, [question?.question_key, storedAnswer])

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score}
        round={question ? `Round ${question.round_number}` : ''}
        question={question ? `Question ${question.round_position} of ${question.round_question_count}` : ''} />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div style={{ borderRadius: 16, overflow: 'hidden', background: C.ground, border: `1px solid ${C.line}`, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180 }}>
          {question?.image_url ? <img src={question.image_url} alt="Question image" style={{ maxHeight: 140, maxWidth: '80%', objectFit: 'contain' }} /> : <span style={{ color: C.sub }}>Loading image…</span>}
        </div>
        <PlayerQuestionCard prompt={question?.prompt ?? 'Loading question…'} eyebrow={question?.category ?? 'Question'} />
        <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>Your answer</label>
        <textarea rows={3} value={answer} onChange={e => setAnswer(e.target.value)} onKeyDown={event => submitPlayerAnswerOnEnter(event, Boolean(answer.trim()) && !submitting, () => { void submit(answer) })} placeholder="Type your answer…"
          style={{ border: `2px solid ${answer ? C.violet : C.line}`, borderRadius: 14, background: C.panel, color: C.ink, fontSize: 18, outline: 'none', width: '100%', padding: '14px 16px', resize: 'none', fontFamily: 'inherit' }} />
        {submitError && <p style={{ color: C.stop, fontSize: 13, marginTop: 10 }}>{submitError}</p>}
      </div>
      <StickyBottom><Btn onClick={() => void submit(answer)} disabled={!answer.trim() || submitting}>{submitting ? 'Submitting…' : snapshot.hasSubmission ? 'Update Answer' : 'Submit Answer'}</Btn></StickyBottom>
    </div>
  )
}

// ─── SCREEN 7 — MULTIPLE CHOICE ───────────────────────────────────────────────
function MultipleChoice({ go }: { go: (s: PlayerScreen) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const question = useLiveQuestionDefinition()
  const snapshot = usePlayerSnapshot()
  const { submit, submitting, submitError } = useSubmitAnswer(go, 'multiple-choice')
  const choices = optionObjects(question?.options)
  const storedSelection = typeof snapshot.rawAnswer === 'string' ? snapshot.rawAnswer : ''

  useEffect(() => {
    // Restore the team's previous response when the host reopens answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(storedSelection || null)
  }, [question?.question_key, storedSelection])

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score}
        round={question ? `Round ${question.round_number}` : ''}
        question={question ? `Question ${question.round_position} of ${question.round_question_count}` : ''} />
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <PlayerQuestionCard prompt={question?.prompt ?? 'Loading question…'} eyebrow={question?.category ?? 'Question'} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {choices.map((choice, i) => {
            const key = choice.key ?? String.fromCharCode(65 + i)
            const selectedNow = selected === key
            return <button key={key} onClick={() => setSelected(key)} onKeyDown={event => submitPlayerAnswerOnEnter(event, selectedNow && !submitting, () => { void submit(key) })}
              style={{ background: selectedNow ? C.violetPale : C.panel, border: `2px solid ${selectedNow ? C.violet : C.line}`, borderRadius: 16, textAlign: 'left', padding: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'inherit' }}>
              <span style={{ background: selectedNow ? C.violet : C.ground, color: selectedNow ? '#fff' : C.sub, borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{key}</span>
              <span style={{ color: C.ink, fontWeight: 600, fontSize: 16 }}>{choice.label ?? ''}</span>
            </button>
          })}
        </div>
        {submitError && <p style={{ color: C.stop, fontSize: 13, marginTop: 10 }}>{submitError}</p>}
      </div>
      <StickyBottom><Btn onClick={() => selected && void submit(selected)} disabled={!selected || submitting}>{submitting ? 'Submitting…' : snapshot.hasSubmission ? 'Update Answer' : 'Submit Answer'}</Btn></StickyBottom>
    </div>
  )
}

// ─── SCREEN 8 — MULTI-ANSWER ──────────────────────────────────────────────────
function MultiAnswer({ go }: { go: (s: PlayerScreen) => void }) {
  const question = useLiveQuestionDefinition()
  const snapshot = usePlayerSnapshot()
  const count = multiAnswerInputCount(question?.points_max, question?.correct_answer)
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const { submit, submitting, submitError } = useSubmitAnswer(go, 'multi-answer')
  const storedAnswersKey = JSON.stringify(asStringArray(snapshot.rawAnswer))

  useEffect(() => {
    const storedAnswers = JSON.parse(storedAnswersKey) as string[]
    // Resize local inputs and restore the team's previous response when answers reopen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnswers(Array.from({ length: count }, (_, i) => storedAnswers[i] ?? ''))
  }, [count, question?.question_key, storedAnswersKey])
  const setA = (i: number, value: string) => setAnswers(current => current.map((answer, index) => index === i ? value : answer))
  const anyFilled = answers.some(answer => answer.trim())

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score}
        round={question ? `Round ${question.round_number}` : ''}
        question={question ? `Question ${question.round_position} of ${question.round_question_count}` : ''} />
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <PlayerQuestionCard prompt={question?.prompt ?? 'Loading question…'} eyebrow={`${question?.category ?? 'Question'} · 1 point per correct answer`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {answers.map((answer, i) => <div key={i}>
            <input value={answer} onChange={e => setA(i, e.target.value)} onKeyDown={event => submitPlayerAnswerOnEnter(event, anyFilled && !submitting, () => { void submit(answers) })} placeholder="Type an answer…"
              aria-label={`Answer ${i + 1}`}
              style={{ border: `2px solid ${answer ? C.violet : C.line}`, borderRadius: 14, background: C.panel, color: C.ink, fontSize: 17, outline: 'none', width: '100%', padding: '13px 16px', fontFamily: 'inherit' }} />
          </div>)}
        </div>
        {submitError && <p style={{ color: C.stop, fontSize: 13, marginTop: 10 }}>{submitError}</p>}
      </div>
      <StickyBottom><Btn onClick={() => void submit(answers)} disabled={!anyFilled || submitting}>{submitting ? 'Submitting…' : snapshot.hasSubmission ? 'Update Answers' : 'Submit Answers'}</Btn></StickyBottom>
    </div>
  )
}

// ─── SCREEN 9 — MULTI-PART ────────────────────────────────────────────────────
function MultiPart({ go }: { go: (s: PlayerScreen) => void }) {
  const question = useLiveQuestionDefinition()
  const snapshot = usePlayerSnapshot()
  const parts = optionObjects(question?.options)
  const count = Math.max(1, parts.length || 3)
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const { submit, submitting, submitError } = useSubmitAnswer(go, 'multi-part')
  const storedAnswersKey = JSON.stringify(asStringArray(snapshot.rawAnswer))

  useEffect(() => {
    const storedAnswers = JSON.parse(storedAnswersKey) as string[]
    // Resize local inputs and restore the team's previous response when answers reopen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnswers(Array.from({ length: count }, (_, i) => storedAnswers[i] ?? ''))
  }, [count, question?.question_key, storedAnswersKey])
  const anyFilled = answers.some(answer => answer.trim())

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score}
        round={question ? `Round ${question.round_number}` : ''}
        question={question ? `Question ${question.round_position} of ${question.round_question_count}` : ''} />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PlayerQuestionCard prompt={question?.prompt ?? 'Loading question…'} eyebrow={`${question?.category ?? 'Question'} · 1 point per part`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {parts.map((part, i) => <div key={part.label ?? i}>
            <p style={{ color: C.violet, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', marginBottom: 8 }}>PART {part.label ?? String.fromCharCode(65 + i)}</p>
            <p style={{ color: C.ink, fontSize: 14, lineHeight: 1.45, marginBottom: 9 }}>{part.clue}</p>
            <input value={answers[i] ?? ''} onChange={e => setAnswers(current => current.map((value, index) => index === i ? e.target.value : value))} onKeyDown={event => submitPlayerAnswerOnEnter(event, anyFilled && !submitting, () => { void submit(answers) })} placeholder="Answer…"
              style={{ border: `2px solid ${answers[i] ? C.violet : C.line}`, borderRadius: 12, background: C.panel, color: C.ink, fontSize: 16, outline: 'none', width: '100%', padding: '12px 14px', fontFamily: 'inherit' }} />
          </div>)}
        </div>
        {submitError && <p style={{ color: C.stop, fontSize: 13, marginTop: 10 }}>{submitError}</p>}
        <div style={{ height: 90 }} />
      </div>
      <StickyBottom><Btn onClick={() => void submit(answers)} disabled={!anyFilled || submitting}>{submitting ? 'Submitting…' : snapshot.hasSubmission ? 'Update Answers' : 'Submit Answers'}</Btn></StickyBottom>
    </div>
  )
}

// ─── SCREEN 10 — RANKING ──────────────────────────────────────────────────────

function Ranking({ go }: { go: (s: PlayerScreen) => void }) {
  const question = useLiveQuestionDefinition()
  const snapshot = usePlayerSnapshot()
  const [items, setItems] = useState<string[]>(['Jupiter', 'Saturn', 'Uranus', 'Neptune'])
  const [justMoved, setJustMoved] = useState<string | null>(null)
  const [justDisplaced, setJustDisplaced] = useState<string | null>(null)
  const { submit, submitting, submitError } = useSubmitAnswer(go, 'ranking')
  const optionItemsKey = JSON.stringify(Array.isArray(question?.options) ? question.options.map(String) : [])
  const storedItemsKey = JSON.stringify(asStringArray(snapshot.rawAnswer))

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const snapshots = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const optionItems = JSON.parse(optionItemsKey) as string[]
    const storedItems = JSON.parse(storedItemsKey) as string[]
    const next = storedItems.length ? storedItems : optionItems
    // Reset the order for a new question, or restore it when answers reopen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next.length) setItems(next)
  }, [question?.question_key, optionItemsKey, storedItemsKey])

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= items.length) return

    snapshots.current = new Map()

    ;[items[i], items[j]].forEach(name => {
      const el = cardRefs.current.get(name)
      if (el) snapshots.current.set(name, el.getBoundingClientRect().top)
    })

    const mover = items[i]
    const displaced = items[j]

    setItems(current => {
      const next = [...current]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

    setJustMoved(mover)
    setJustDisplaced(displaced)

    window.setTimeout(() => {
      setJustMoved(null)
      setJustDisplaced(null)
    }, 420)
  }

  useLayoutEffect(() => {
    if (snapshots.current.size === 0) return

    snapshots.current.forEach((oldTop, name) => {
      const el = cardRefs.current.get(name)
      if (!el) return

      const newTop = el.getBoundingClientRect().top
      const delta = oldTop - newTop
      if (delta === 0) return

      el.style.transition = 'none'
      el.style.transform = `translateY(${delta}px)`
      el.getBoundingClientRect()
      el.style.transition = 'transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)'
      el.style.transform = 'translateY(0px)'
    })

    snapshots.current = new Map()
  })

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }} onKeyDown={event => submitPlayerAnswerOnEnter(event, items.length > 0 && !submitting, () => { void submit(items) })}>
      <TopBar
        team={snapshot.teamName || 'Your Team'}
        score={snapshot.score}
        round={question ? `Round ${question.round_number}` : ''}
        question={question ? `Question ${question.round_position} of ${question.round_question_count}` : ''}
      />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <PlayerQuestionCard prompt={question?.prompt ?? 'Loading question…'} eyebrow="Put these in order" />
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 16 }}>Tap the arrows to change the order.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item, i) => {
            const isActive = justMoved === item
            const isNudged = justDisplaced === item

            return (
              <div
                key={item}
                ref={el => {
                  if (el) cardRefs.current.set(item, el)
                  else cardRefs.current.delete(item)
                }}
                style={{
                  background: isActive ? C.violetPale : C.panel,
                  border: `2px solid ${isActive ? C.violet : isNudged ? '#C4BFEE' : C.line}`,
                  borderRadius: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  boxShadow: isActive ? '0 6px 20px rgba(124,58,237,0.18)' : 'none',
                  transition: 'background 0.22s ease, border-color 0.22s ease, box-shadow 0.3s ease',
                  position: 'relative',
                  zIndex: isActive ? 1 : 0,
                }}
              >
                <span
                  key={`${item}-${i}`}
                  className="rank-badge-changed"
                  style={{
                    background: C.violet,
                    color: '#fff',
                    borderRadius: 10,
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>

                <span
                  style={{
                    color: isActive ? C.violet : C.ink,
                    fontWeight: isActive ? 700 : 600,
                    fontSize: 17,
                    flex: 1,
                    transition: 'color 0.22s ease',
                  }}
                >
                  {item}
                </span>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {([
                    { dir: -1 as const, icon: '▲', disabled: i === 0 },
                    { dir: 1 as const, icon: '▼', disabled: i === items.length - 1 },
                  ] as const).map(({ dir, icon, disabled }) => (
                    <button
                      key={icon}
                      onClick={() => move(i, dir)}
                      disabled={disabled}
                      style={{
                        background: disabled ? C.ground : isActive ? C.violet : C.violetPale,
                        color: disabled ? C.sub : isActive ? '#fff' : C.violet,
                        border: 'none',
                        borderRadius: 8,
                        width: 34,
                        height: 28,
                        fontSize: 12,
                        cursor: disabled ? 'default' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.2s ease, color 0.2s ease',
                        fontFamily: 'inherit',
                      }}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {submitError && <p style={{ color: C.stop, fontSize: 13, marginTop: 10 }}>{submitError}</p>}
      </div>

      <StickyBottom>
        <Btn onClick={() => void submit(items)} disabled={submitting}>
          {submitting ? 'Submitting…' : snapshot.hasSubmission ? 'Update Order' : 'Lock In Order'}
        </Btn>
      </StickyBottom>
    </div>
  )
}

function BonusAnswer({ go }: { go: (s: PlayerScreen) => void }) {
  const [answer, setAnswer] = useState('')
  const question = useLiveQuestionDefinition()
  const snapshot = usePlayerSnapshot()
  const bonus = playerBonusFromJson(question?.bonus)
  const { submit, submitting, submitError } = useSubmitBonusAnswer(go)

  useEffect(() => {
    // Restore the team's previous bonus response when the host reopens answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnswer(snapshot.bonusAnswer)
  }, [question?.question_key, snapshot.bonusAnswer])

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score}
        round={question ? `Round ${question.round_number}` : ''}
        question={question ? `Question ${question.round_position} of ${question.round_question_count}` : ''} />
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {bonus?.imageUrl && (
          <div style={{ borderRadius: 16, overflow: 'hidden', background: C.ground, border: `1px solid ${C.line}`, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180 }}>
            <div role="img" aria-label="Bonus image" style={{ width: '85%', height: 150, backgroundImage: `url(${bonus.imageUrl})`, backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundSize: 'contain' }} />
          </div>
        )}
        <PlayerQuestionCard
          prompt={bonus?.prompt ?? 'Loading bonus…'}
          eyebrow={`Bonus · ${bonus?.points ?? 1} ${(bonus?.points ?? 1) === 1 ? 'point' : 'points'}`}
          tone="bonus"
        />
        <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>Your bonus answer</label>
        <textarea rows={3} value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => submitPlayerAnswerOnEnter(event, Boolean(answer.trim()) && !submitting, () => { void submit(answer) })} placeholder="Type your answer…"
          style={{ border: `2px solid ${answer ? C.violet : C.line}`, borderRadius: 14, background: C.panel, color: C.ink, fontSize: 18, fontWeight: 500, outline: 'none', width: '100%', padding: '14px 16px', resize: 'none', fontFamily: 'inherit' }} />
        {submitError && <p style={{ color: C.stop, fontSize: 13, marginTop: 10 }}>{submitError}</p>}
      </div>
      <StickyBottom><Btn onClick={() => void submit(answer)} disabled={!answer.trim() || submitting}>{submitting ? 'Submitting…' : snapshot.hasBonusSubmission ? 'Update Bonus Answer' : 'Submit Bonus Answer'}</Btn></StickyBottom>
    </div>
  )
}

function BonusSubmitted() {
  const snapshot = usePlayerSnapshot()
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} round={snapshot.roundLabel} question={snapshot.questionLabel} />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PlayerQuestionCard prompt={snapshot.prompt || 'Question submitted'} />
        <div className="mb-5 flex items-center gap-3">
          <div style={{ background: C.violetPale, borderRadius: 999, width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 21 }}>🔒</span></div>
          <div>
            <h1 style={{ color: C.ink, fontSize: 24 }} className="font-black">Answers locked in</h1>
            <p style={{ color: C.sub, fontSize: 13, marginTop: 2 }}>Your main and bonus answers are saved.</p>
          </div>
        </div>
        <div className="space-y-2">
          <div style={{ background: C.panel, borderRadius: 16, border: `1px solid ${C.line}`, width: '100%', padding: '14px 18px', textAlign: 'left' }}>
            <p style={{ color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em' }}>{playerResponseLabel(snapshot.questionType)}</p>
            <p style={{ color: C.ink, fontSize: 18, fontWeight: 800, marginTop: 5 }}>{snapshot.answer || 'Submitted'}</p>
          </div>
          <div style={{ background: C.violetPale, borderRadius: 16, border: `1px solid ${C.line}`, width: '100%', padding: '14px 18px', textAlign: 'left' }}>
            <p style={{ color: C.violet, fontSize: 11, fontWeight: 900, letterSpacing: '0.08em' }}>BONUS ANSWER</p>
            <p style={{ color: C.ink, fontSize: 18, fontWeight: 800, marginTop: 5 }}>{snapshot.bonusAnswer || 'Submitted'}</p>
          </div>
        </div>
        <div style={{ marginTop: 24 }}><WaitMsg msg="Waiting for the host to close answers…" /></div>
      </div>
    </div>
  )
}

// ─── SCREEN 11 — SUBMITTED ────────────────────────────────────────────────────
function Submitted({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  const question = useLiveQuestionDefinition()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} round={snapshot.roundLabel} question={snapshot.questionLabel} />
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <PlayerQuestionCard prompt={snapshot.prompt || 'Question submitted'} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <div style={{ background: C.violetPale, borderRadius: 999, width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 26 }}>🔒</span></div>
          <h1 style={{ color: C.ink, fontSize: 28 }} className="font-black">Answer locked in</h1>
          <div style={{ background: C.ground, borderRadius: 16, border: `1px solid ${C.line}`, width: '100%', padding: '16px 20px' }}>
            <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{playerResponseLabel(snapshot.questionType)}</p>
            <p style={{ color: C.ink, fontSize: 18, fontWeight: 800 }}>{snapshot.answer || 'Submitted'}</p>
          </div>
          {question?.has_bonus && !question.bonus && (
            <div style={{ background: C.violetPale, border: `1px solid #C4B5FD`, borderRadius: 14, width: '100%', padding: '12px 16px', textAlign: 'center' }}>
              <p style={{ color: C.violet, fontSize: 14, fontWeight: 800 }}>★ Bonus question coming next</p>
            </div>
          )}
          {snapshot.bonusAnswer && (
            <div style={{ background: C.violetPale, border: `1px solid #C4B5FD`, borderRadius: 14, width: '100%', padding: '12px 16px' }}>
              <p style={{ color: C.violet, fontSize: 11, fontWeight: 900, letterSpacing: '0.08em' }}>BONUS ANSWER LOCKED</p>
              <p style={{ color: C.ink, fontSize: 16, fontWeight: 800, marginTop: 5 }}>{snapshot.bonusAnswer}</p>
            </div>
          )}
          {scoresVisible && <p style={{ color: C.sub, fontSize: 14, marginTop: -8 }}>Your score: {snapshot.score}</p>}
          <WaitMsg msg="Waiting for the host…" />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 12 — NO ANSWER ────────────────────────────────────────────────────
function NoAnswer({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} round={snapshot.roundLabel} question={snapshot.questionLabel} />
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p style={{ color: C.sub, fontSize: 13, marginBottom: 18 }}>{snapshot.prompt}</p>
        <div style={{ background: C.cautionMist, borderRadius: 999, border: `2px solid ${C.cautionBorder}`, width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}><span style={{ fontSize: 26 }}>⏱</span></div>
        <h1 style={{ color: C.ink, fontSize: 26 }} className="font-black mb-3">Answers are closed</h1>
        <div style={{ background: C.cautionMist, borderRadius: 14, border: `1px solid ${C.cautionBorder}`, padding: '12px 24px', marginBottom: 16 }}><p style={{ color: C.caution, fontSize: 16, fontWeight: 700 }}>No answer submitted</p></div>
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 28 }}>This question will score 0 points.</p>
        <WaitMsg msg="Waiting for the answer…" />
      </div>
    </div>
  )
}

// ─── SCREEN 13 — CORRECT ──────────────────────────────────────────────────────
function Correct({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} round={snapshot.roundLabel} question={snapshot.questionLabel} />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PlayerQuestionCard prompt={snapshot.prompt || 'Question result'} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ background: C.goMist, borderRadius: 999, border: `2px solid ${C.goBorder}`, width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 26, color: C.go }}>✓</span></div>
          <h1 style={{ color: C.go, fontSize: 38 }} className="font-black">Correct!</h1>
          <PlayerQuestionResultSummary snapshot={snapshot} />
          {scoresVisible && <div style={{ background: C.violetPale, borderRadius: 14, width: '100%', padding: '12px 20px' }}><p style={{ color: C.violet, fontSize: 28, fontWeight: 900 }}>{snapshot.score} points</p><p style={{ color: C.sub, fontSize: 13 }}>Updated score</p></div>}
          <WaitMsg msg="Waiting for the next question…" />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 14 — INCORRECT ────────────────────────────────────────────────────
function Incorrect({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} round={snapshot.roundLabel} question={snapshot.questionLabel} />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PlayerQuestionCard prompt={snapshot.prompt || 'Question result'} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ background: C.stopMist, borderRadius: 999, border: `2px solid ${C.stopBorder}`, width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 28, color: C.stop }}>×</span></div>
          <h1 style={{ color: C.ink, fontSize: 36 }} className="font-black">Not quite</h1>
          <PlayerQuestionResultSummary snapshot={snapshot} />
          {scoresVisible && <div style={{ background: C.ground, borderRadius: 14, border: `1px solid ${C.line}`, width: '100%', padding: '12px 20px', textAlign: 'center' }}><p style={{ color: C.ink, fontSize: 22, fontWeight: 900 }}>{snapshot.score} points</p><p style={{ color: C.sub, fontSize: 13 }}>Your score</p></div>}
          <WaitMsg msg="Waiting for the next question…" />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 15 — CONTENT SCREEN ───────────────────────────────────────────────
function ContentScreen() {
  const snapshot = usePlayerSnapshot()
  const contentScreen = useLiveContentScreenDefinition()
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} round={contentScreen ? `Round ${contentScreen.round_number}` : ''} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        {contentScreen?.image_url ? (
          <div role="img" aria-label="Content screen image" style={{ backgroundImage: `url(${contentScreen.image_url})`, borderRadius: 20, width: '100%', maxWidth: 340, height: 220, backgroundPosition: 'center', backgroundSize: 'cover', marginBottom: 24 }} />
        ) : (
          <div style={{ background: C.violetPale, borderRadius: 24, width: 72, height: 72 }} className="flex items-center justify-center mb-6 shrink-0">
            <span style={{ fontSize: 32 }}>✦</span>
          </div>
        )}
        <p style={{ color: C.violet, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>{contentScreen?.round_title ?? 'Content Screen'}</p>
        <h1 style={{ color: C.ink, fontSize: 28, lineHeight: 1.2 }} className="font-black mb-4">
          {contentScreen?.title ?? 'Loading content screen…'}
        </h1>
        {contentScreen?.body && <p style={{ color: C.sub, fontSize: 16, lineHeight: 1.6, maxWidth: 300 }}>{contentScreen.body}</p>}
        <WaitMsg msg="Waiting for the host to continue…" />
      </div>
    </div>
  )
}

// ─── SCREEN 16 — INTERMISSION ─────────────────────────────────────────────────
function Intermission({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} />
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 8 }}>{snapshot.roundLabel} complete</p>
        <h1 style={{ color: C.ink, fontSize: 34 }} className="font-black mb-2">Intermission</h1>
        <p style={{ color: C.sub, fontSize: 15, marginBottom: 28 }}>The next round will begin shortly.</p>
        {scoresVisible && <div style={{ background: C.violetPale, borderRadius: 18, width: '100%', maxWidth: 300, padding: '18px 24px', marginBottom: 18 }}>
          <p style={{ color: C.sub, fontSize: 11, fontWeight: 700 }}>YOUR SCORE</p>
          <p style={{ color: C.violet, fontSize: 42, fontWeight: 900 }}>{snapshot.score}</p>
        </div>}
        <WaitMsg msg="Waiting for the host…" />
      </div>
    </div>
  )
}

// ─── SCREEN 17 — ROUND RESULTS ────────────────────────────────────────────────
function LeaderboardResults({ scope }: { scope: 'question' | 'round' }) {
  const snapshot = usePlayerSnapshot()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  const { teams, teamId } = useLiveLeaderboard()
  const myIndex = teams.findIndex(team => team.id === teamId)
  const afterQuestion = scope === 'question'
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} />
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <p style={{ color: C.sub, fontSize: 14, textAlign: 'center', marginBottom: 8 }}>
          {afterQuestion ? `${snapshot.questionLabel} complete` : `${snapshot.roundLabel} complete`}
        </p>
        <div style={{ background: C.violetPale, borderRadius: 18, padding: '18px 20px', textAlign: 'center', marginBottom: 22 }}>
          <p style={{ color: C.violet, fontSize: 18, fontWeight: 800 }}>{snapshot.teamName}</p>
          {scoresVisible && <p style={{ color: C.ink, fontSize: 36, fontWeight: 900 }}>{snapshot.score}</p>}
          <p style={{ color: C.violet, fontSize: 13, fontWeight: 700 }}>{myIndex >= 0 ? `${myIndex + 1}${myIndex === 0 ? 'st' : myIndex === 1 ? 'nd' : myIndex === 2 ? 'rd' : 'th'} place` : ''}</p>
        </div>
        <p style={{ color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', marginBottom: 10 }}>LEADERBOARD</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {teams.map((team, i) => <div key={team.id} style={{ background: team.id === teamId ? C.violetMist : C.panel, border: `1px solid ${team.id === teamId ? C.violet : C.line}`, borderRadius: 13, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: C.sub, width: 20, fontWeight: 800 }}>{i + 1}</span><span style={{ color: C.ink, flex: 1, fontWeight: team.id === teamId ? 800 : 600 }}>{team.name}</span>{scoresVisible && <span style={{ color: C.ink, fontWeight: 800 }}>{team.score}</span>}
          </div>)}
        </div>
        <div style={{ marginTop: 24 }}><WaitMsg msg={afterQuestion ? 'Waiting for the next question…' : 'Waiting for the next round…'} /></div>
      </div>
    </div>
  )
}

function QuestionResults() {
  return <LeaderboardResults scope="question" />
}

function RoundResults() {
  return <LeaderboardResults scope="round" />
}

// ─── SCREEN 18 — DELAYED REVEAL ───────────────────────────────────────────────
function DelayedReveal({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  const fullyCorrect = snapshot.pointsAwarded > 0 && snapshot.pointsAwarded >= snapshot.pointsMax
  const partiallyCorrect = snapshot.pointsAwarded > 0 && snapshot.pointsAwarded < snapshot.pointsMax
  const resultTitle = !snapshot.answer
    ? 'No answer submitted'
    : fullyCorrect
      ? 'Correct!'
      : partiallyCorrect
        ? `${snapshot.pointsAwarded} of ${snapshot.pointsMax} correct`
        : 'Not quite'

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} round={`${snapshot.roundLabel} — Answers`} question={snapshot.questionLabel} />

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PlayerQuestionCard prompt={snapshot.prompt || 'Loading answer…'} />
        <div className="flex flex-col items-center gap-4">
          <h1 style={{ color: fullyCorrect || partiallyCorrect ? C.go : C.ink, fontSize: 30 }} className="font-black">{resultTitle}</h1>
          <PlayerQuestionResultSummary snapshot={snapshot} />
          {scoresVisible && <div style={{ background: C.violetPale, borderRadius: 14, width: '100%', padding: '12px 20px' }}><p style={{ color: C.violet, fontSize: 28, fontWeight: 900 }}>{snapshot.score} points</p><p style={{ color: C.sub, fontSize: 13 }}>Updated score</p></div>}
          <WaitMsg msg="Waiting for the next answer…" />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 19 — WINNER ───────────────────────────────────────────────────────
const FINAL_LB = [
  { name: 'Trivia Newton John', score: 48 },
  { name: 'Quizteama Aguilera', score: 43 },
  { name: 'Risky Quizness', score: 38 },
  { name: 'Norfolk & Chance', score: 31 },
]

function Winner({ go }: { go: (s: PlayerScreen) => void }) {
  const MY = 'Trivia Newton John'
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div style={{ background: C.violet, padding: '28px 24px 32px', textAlign: 'center', flexShrink: 0 }}>
        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Game Complete</p>
        <p style={{ color: '#fff', fontSize: 17, fontWeight: 600, marginBottom: 8 }}>You did it!</p>
        <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 16, display: 'inline-block', padding: '8px 20px', marginBottom: 14 }}>
          <span style={{ color: '#fff', fontSize: 28, fontWeight: 900 }}>🏆 1st Place</span>
        </div>
        <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Trivia Newton John</h1>
        <p style={{ color: '#fff', fontSize: 52, fontWeight: 900, lineHeight: 1 }}>48</p>
        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 4, marginBottom: 16 }}>Final score</p>
        <div style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 16, padding: '12px 20px' }}>
          <p style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>You’ve won a $100 venue voucher!</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <p style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Final Standings</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FINAL_LB.map((t, i) => {
            const isMe = t.name === MY
            return (
              <div key={t.name} style={{
                background: isMe ? C.violetPale : C.panel,
                border: `2px solid ${isMe ? C.violet : C.line}`,
                borderRadius: 14,
                display: 'flex', alignItems: 'center',
                padding: '12px 16px', gap: 12,
              }}>
                <span style={{ color: isMe ? C.violet : C.sub, fontWeight: 800, fontSize: 13, width: 18 }}>{i + 1}</span>
                <span style={{ color: C.ink, fontWeight: isMe ? 700 : 500, flex: 1, fontSize: 14 }}>{t.name}</span>
                <span style={{ color: isMe ? C.violet : C.sub, fontWeight: 700, fontSize: 15 }}>{t.score}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 20 — FINAL RESULT ─────────────────────────────────────────────────
function FinalResult({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  const visibility = useLeaderboardVisibility()
  const showFinalLeaderboard = visibility !== null && playersSeeFinalLeaderboard(visibility)
  const { teams, teamId } = useLiveLeaderboard(showFinalLeaderboard)
  const myIndex = teams.findIndex(team => team.id === teamId)
  const me = teams.find(team => team.id === teamId)
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div className="flex-1 overflow-y-auto px-5 py-6 text-center">
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 8 }}>Game Complete</p>
        <h1 style={{ color: C.ink, fontSize: 24 }} className="font-black mb-4">{snapshot.teamName || me?.name || 'Your Team'}</h1>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: '18px 20px', display: 'inline-block', minWidth: 180, marginBottom: 24 }}>
          <p style={{ color: C.sub, fontSize: 11, fontWeight: 800 }}>{showFinalLeaderboard ? 'YOU FINISHED' : scoresVisible ? 'YOUR FINAL SCORE' : 'GAME COMPLETE'}</p>
          {(showFinalLeaderboard || scoresVisible) && <p style={{ color: C.ink, fontSize: 48, fontWeight: 900 }}>{showFinalLeaderboard ? (me?.final_placement ?? (myIndex >= 0 ? myIndex + 1 : '—')) : snapshot.score}</p>}
          <p style={{ color: C.sub, fontSize: 13 }}>{showFinalLeaderboard && scoresVisible ? `Final score: ${me?.score ?? snapshot.score}` : 'Thanks for playing!'}</p>
        </div>
        {snapshot.prizeAwards.length > 0 && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 16, padding: '18px 20px', marginBottom: 24, textAlign: 'left' }}>
            <p style={{ color: '#92400E', fontSize: 12, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              {snapshot.prizeAwards.length === 1 ? 'You’ve won a prize!' : 'You’ve won prizes!'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {snapshot.prizeAwards.map((award, index) => (
                <p key={`${award.placement}-${index}`} style={{ color: C.ink, fontSize: 16, fontWeight: 800 }}>{award.message}</p>
              ))}
            </div>
          </div>
        )}
        {showFinalLeaderboard ? (
          <>
            <p style={{ color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textAlign: 'left', marginBottom: 10 }}>FINAL STANDINGS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {teams.map((team, i) => <div key={team.id} style={{ background: team.id === teamId ? C.violetMist : C.panel, border: `1px solid ${team.id === teamId ? C.violet : C.line}`, borderRadius: 13, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
                <span style={{ color: C.sub, width: 20, fontWeight: 800 }}>{team.final_placement ?? i + 1}</span><span style={{ color: C.ink, flex: 1, fontWeight: team.id === teamId ? 800 : 600 }}>{team.name}</span>{scoresVisible && <span style={{ color: C.violet, fontWeight: 800 }}>{team.score}</span>}
              </div>)}
            </div>
            <p style={{ color: C.sub, fontSize: 13, marginTop: 24 }}>Thanks for playing!</p>
          </>
        ) : (
          <div style={{ background: C.ground, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 18px' }}>
            <p style={{ color: C.sub, fontSize: 13, fontStyle: 'italic' }}>Final standings aren’t being shown for this game.</p>
          </div>
        )}
      </div>
    </div>
  )
}

type PlayerTiebreakerState = {
  attempt_id: string
  prompt: string | null
  answer_unit: string | null
  attempt_status: 'open' | 'closed' | 'resolved' | 'tied'
  is_participant: boolean
  numeric_answer: number | null
  distance: number | null
  correct_value: number | null
  is_winner: boolean | null
  submitted_count: number
  participant_count: number
}

function TiebreakerPending() {
  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
      <div style={{ background: C.cautionMist, color: C.caution, width: 62, height: 62, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 20 }}>＝</div>
      <h1 style={{ color: C.ink, fontSize: 28 }} className="font-black mb-3">The final scores are tied</h1>
      <p style={{ color: C.sub, fontSize: 15, lineHeight: 1.6 }}>The host is choosing how to resolve the final placement.</p>
    </div>
  )
}

function LiveTiebreaker() {
  const [state, setState] = useState<PlayerTiebreakerState | null>(null)
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const gameId = localStorage.getItem('simple-trivia-game-id')
    const teamId = localStorage.getItem('simple-trivia-team-id')
    if (!gameId || !teamId) return
    const { data, error: loadError } = await supabase.rpc('get_player_tiebreaker_state', {
      p_game_id: gameId,
      p_team_id: teamId,
    }).maybeSingle()
    if (loadError) {
      console.error('Could not load player tiebreaker:', loadError)
      setError('Could not load the tiebreaker. Please try again.')
      return
    }
    const next = data as PlayerTiebreakerState | null
    setState(next)
    if (next?.numeric_answer !== null && next?.numeric_answer !== undefined) setAnswer(String(next.numeric_answer))
  }, [])

  useEffect(() => {
    // The first async read synchronizes this screen with the persisted attempt.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const gameId = localStorage.getItem('simple-trivia-game-id')
    if (!gameId) return
    const channel = supabase
      .channel(`player-tiebreaker-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const gameId = localStorage.getItem('simple-trivia-game-id')
    const teamId = localStorage.getItem('simple-trivia-team-id')
    const numericAnswer = Number(answer)
    if (!gameId || !teamId || !answer.trim() || !Number.isFinite(numericAnswer) || submitting) return
    setSubmitting(true)
    setError(null)
    const { error: submitError } = await supabase.rpc('submit_player_tiebreaker', {
      p_game_id: gameId,
      p_team_id: teamId,
      p_numeric_answer: numericAnswer,
    })
    if (submitError) {
      console.error('Could not submit tiebreaker:', submitError)
      setError('Could not submit that answer. Please try again.')
    } else {
      await load()
    }
    setSubmitting(false)
  }

  if (!state) return <TiebreakerPending />
  if (!state.is_participant) {
    return (
      <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
        <div style={{ fontSize: 46, marginBottom: 16 }}>⏳</div>
        <h1 style={{ color: C.ink, fontSize: 26 }} className="font-black mb-3">A final placement is being decided</h1>
        <p style={{ color: C.sub, fontSize: 15 }}>Only the tied teams need to answer. You’ll see the final standings shortly.</p>
      </div>
    )
  }

  const revealed = state.attempt_status === 'resolved' || state.attempt_status === 'tied'
  const hasSubmitted = state.numeric_answer !== null
  const outcome = playerTiebreakerOutcome(state.attempt_status, state.is_winner)
  if (revealed && outcome) {
    const won = outcome === 'won'
    const tied = outcome === 'tied'
    return (
      <div className="flex flex-col" style={{ minHeight: '100%' }}>
        <div style={{ background: C.violet, color: 'white', padding: '24px 22px 28px', textAlign: 'center' }}>
          <p style={{ opacity: 0.75, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Final Tiebreaker</p>
          <h1 style={{ fontSize: 25, fontWeight: 900, lineHeight: 1.3, marginTop: 12 }}>{state.prompt}</h1>
        </div>
        <div className="flex-1 px-5 py-6">
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: '22px', textAlign: 'center' }}>
            <div
              style={{
                background: won ? '#DCFCE7' : tied ? C.cautionMist : C.violetMist,
                color: won ? C.go : tied ? C.caution : C.violet,
                width: 58,
                height: 58,
                borderRadius: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 27,
                margin: '0 auto 14px',
              }}
            >
              {won ? '★' : tied ? '＝' : '◆'}
            </div>
            <h2 style={{ color: won ? C.go : tied ? C.caution : C.ink, fontSize: 30 }} className="font-black">
              {won ? 'You Won the Tie!' : tied ? 'The Tie Remains!' : 'You Lost the Tie!'}
            </h2>
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 20, paddingTop: 20 }}>
              <p style={{ color: C.sub, fontSize: 12, fontWeight: 800 }}>CORRECT ANSWER</p>
              <p style={{ color: C.go, fontSize: 34, fontWeight: 900, marginTop: 6 }}>{state.correct_value}{state.answer_unit ? ` ${state.answer_unit}` : ''}</p>
              <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 18, paddingTop: 18 }}>
                <p style={{ color: C.sub, fontSize: 13 }}>Your answer: <strong style={{ color: C.ink }}>{state.numeric_answer}</strong></p>
                <p style={{ color: C.sub, fontSize: 13, marginTop: 4 }}>Distance from correct: <strong style={{ color: C.ink }}>{state.distance}</strong></p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div style={{ background: C.violet, color: 'white', padding: '24px 22px 28px', textAlign: 'center' }}>
        <p style={{ opacity: 0.75, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Final Tiebreaker</p>
        <h1 style={{ fontSize: 25, fontWeight: 900, lineHeight: 1.3, marginTop: 12 }}>{state.prompt}</h1>
      </div>
      <div className="flex-1 px-5 py-6">
        {state.attempt_status === 'closed' ? (
          <div style={{ background: C.ground, border: `1px solid ${C.line}`, borderRadius: 18, padding: '24px', textAlign: 'center' }}>
            <p style={{ color: C.ink, fontSize: 20, fontWeight: 900 }}>{state.numeric_answer}</p>
            <p style={{ color: C.sub, fontSize: 14, marginTop: 8 }}>Answers are closed. Waiting for the reveal…</p>
          </div>
        ) : hasSubmitted ? (
          <div style={{ background: '#F0FDF4', border: `1px solid ${C.go}`, borderRadius: 18, padding: '24px', textAlign: 'center' }}>
            <div style={{ background: C.go, color: 'white', width: 42, height: 42, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, margin: '0 auto 14px' }}>✓</div>
            <p style={{ color: C.ink, fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Answer locked in</p>
            <p style={{ color: C.go, fontSize: 28, fontWeight: 900, marginTop: 6 }}>{state.numeric_answer}{state.answer_unit ? ` ${state.answer_unit}` : ''}</p>
            <p style={{ color: C.sub, fontSize: 14, marginTop: 10 }}>Waiting for the host to close answers…</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={{ color: C.sub, fontSize: 12, fontWeight: 800 }}>YOUR CLOSEST ANSWER{state.answer_unit ? ` (${state.answer_unit})` : ''}</label>
            <input type="number" step="any" inputMode="decimal" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Enter a number"
              style={{ width: '100%', marginTop: 8, border: `2px solid ${C.line}`, borderRadius: 16, padding: '16px', fontSize: 22, fontWeight: 800, color: C.ink, background: C.panel }} />
            {error && <p style={{ color: C.stop, fontSize: 13, fontWeight: 700, marginTop: 10 }}>{error}</p>}
            <button type="submit" disabled={!answer.trim() || submitting} style={{ width: '100%', marginTop: 16, background: C.violet, color: 'white', borderRadius: 16, padding: '15px', fontSize: 16, fontWeight: 900, opacity: !answer.trim() || submitting ? 0.5 : 1 }}>
              {submitting ? 'Submitting…' : 'Submit Answer'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── SCREEN 21 — RECONNECTING ─────────────────────────────────────────────────
function Reconnecting() {
  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
      <div className="animate-spin" style={{
        borderRadius: 999,
        width: 56, height: 56,
        border: `3px solid ${C.line}`,
        borderTopColor: C.violet,
        marginBottom: 20,
      }} />
      <h1 style={{ color: C.ink, fontSize: 26 }} className="font-black mb-2">Trying to reconnect…</h1>
      <p style={{ color: C.sub, fontSize: 15 }}>Your answer and team are safe.</p>
    </div>
  )
}

// ─── SCREEN 22 — GAME ENDED ───────────────────────────────────────────────────
function GameEnded({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
      <div style={{ background: C.ground, borderRadius: 999, width: 64, height: 64 }}
        className="flex items-center justify-center mb-5 shrink-0">
        <span style={{ fontSize: 28 }}>🎤</span>
      </div>
      <h1 style={{ color: C.ink, fontSize: 26 }} className="font-black mb-3">This game has ended.</h1>
      <p style={{ color: C.sub, fontSize: 15, marginBottom: 32 }}>Thanks for playing Simple Trivia.</p>
      <div style={{ width: '100%', maxWidth: 280 }}>
        <Btn onClick={() => go('join')}>Join Another Game</Btn>
      </div>
    </div>
  )
}

// ─── SCREEN 13b — PARTIAL CREDIT ──────────────────────────────────────────────
function PartialCorrect({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  const totalAwarded = snapshot.pointsAwarded + snapshot.bonusPointsAwarded
  const totalMax = snapshot.pointsMax + snapshot.bonusPointsMax
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} round={snapshot.roundLabel} question={snapshot.questionLabel} />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PlayerQuestionCard prompt={snapshot.prompt || 'Question result'} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ background: C.goMist, borderRadius: 999, border: `2px solid ${C.goBorder}`, width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.go, fontWeight: 900 }}>½</div>
          <h1 style={{ color: C.ink, fontSize: 30 }} className="font-black">{totalAwarded} of {totalMax} points</h1>
          <PlayerQuestionResultSummary snapshot={snapshot} />
          {scoresVisible && <div style={{ background: C.violetPale, borderRadius: 14, width: '100%', padding: '12px 20px' }}><p style={{ color: C.violet, fontSize: 28, fontWeight: 900 }}>{snapshot.score} points</p><p style={{ color: C.sub, fontSize: 13 }}>Updated score</p></div>}
          <WaitMsg msg="Waiting for the next question…" />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 17b — ROUND RESULTS (LEADERBOARD HIDDEN) ─────────────────────────
function RoundResultsHidden({ go }: { go: (s: PlayerScreen) => void }) {
  const snapshot = usePlayerSnapshot()
  const scoresVisible = useContext(PlayerScoreVisibilityContext)
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team={snapshot.teamName || 'Your Team'} score={snapshot.score} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p style={{ color: C.sub, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{snapshot.roundLabel} Complete</p>

        {scoresVisible ? <div style={{ background: C.violetPale, borderRadius: 24, width: '100%', maxWidth: 300, padding: '32px 24px', marginBottom: 24 }}>
          <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Your score</p>
          <p style={{ color: C.violet, fontSize: 60, fontWeight: 900, lineHeight: 1 }}>{snapshot.score}</p>
        </div> : <div style={{ background: C.ground, border: `1px solid ${C.line}`, borderRadius: 14, width: '100%', maxWidth: 300, padding: '14px 18px', marginBottom: 24 }}><p style={{ color: C.sub, fontSize: 13 }}>Scores are hidden for this game.</p></div>}

        <p style={{ color: C.sub, fontSize: 15, lineHeight: 1.6, maxWidth: 260, marginBottom: 28 }}>
          The next round will begin shortly.
        </p>

        <WaitMsg msg="Waiting for the host…" />

        <div style={{ marginTop: 16 }}>
          <HostAdvance label="host starts Round 3" to="round-start" go={go} />
        </div>

        <div style={{
          marginTop: 28,
          background: C.ground,
          borderRadius: 12,
          border: `1px solid ${C.line}`,
          padding: '10px 16px',
          maxWidth: 300,
          width: '100%',
        }}>
          <p style={{ color: C.sub, fontSize: 13, fontStyle: 'italic' }}>
            Standings aren’t being shown right now.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN RENDERER ──────────────────────────────────────────────────────────
function renderScreen(screen: PlayerScreen, go: (s: PlayerScreen) => void) {
  switch (screen) {
    case 'join':           return <JoinGame go={go} />
    case 'team-setup':     return <TeamSetup go={go} />
    case 'waiting':        return <Waiting go={go} />
    case 'round-start':    return <RoundStart />
    case 'single-answer':  return <SingleAnswer go={go} />
    case 'image-question': return <ImageQuestion go={go} />
    case 'multiple-choice':return <MultipleChoice go={go} />
    case 'multi-answer':   return <MultiAnswer go={go} />
    case 'multi-part':     return <MultiPart go={go} />
    case 'ranking':        return <Ranking go={go} />
    case 'bonus-answer':   return <BonusAnswer go={go} />
    case 'bonus-submitted':return <BonusSubmitted />
    case 'submitted':      return <Submitted go={go} />
    case 'no-answer':      return <NoAnswer go={go} />
    case 'correct':        return <Correct go={go} />
    case 'incorrect':            return <Incorrect go={go} />
    case 'partial-correct':      return <PartialCorrect go={go} />
    case 'content-screen':       return <ContentScreen />
    case 'intermission':   return <Intermission go={go} />
    case 'question-results':      return <QuestionResults />
    case 'round-results':         return <RoundResults />
    case 'round-results-hidden':  return <RoundResultsHidden go={go} />
    case 'delayed-reveal': return <DelayedReveal go={go} />
    case 'winner':         return <Winner go={go} />
    case 'final-result':   return <FinalResult go={go} />
    case 'tiebreaker-pending': return <TiebreakerPending />
    case 'tiebreaker':     return <LiveTiebreaker />
    case 'tiebreaker-result': return <LiveTiebreaker />
    case 'reconnecting':   return <Reconnecting />
    case 'game-ended':     return <GameEnded go={go} />
  }
}


export function PlayerFlow() {
  const [screen, setScreen] = useState<PlayerScreen>('join')
  const [restoringSession, setRestoringSession] = useState(true)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [scoresVisible, setScoresVisible] = useState(true)
  useLivePlayerSync(screen, setScreen, !restoringSession)

  useEffect(() => {
    if (screen === 'join' || screen === 'team-setup') return
    const gameId = localStorage.getItem('simple-trivia-game-id')
    if (!gameId) return
    const activeGameId = gameId
    let active = true

    async function loadScoreVisibility() {
      const { data, error } = await supabase.from('games').select('settings').eq('id', activeGameId).maybeSingle()
      if (!active) return
      if (error) {
        console.error('Could not load player score visibility:', error)
        return
      }
      setScoresVisible(playersSeeScoresFromSettings(data?.settings))
    }

    void loadScoreVisibility()
    return () => { active = false }
  }, [screen])

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function clearStoredSession() {
      PLAYER_SESSION_KEYS.forEach(key => localStorage.removeItem(key))
    }

    function retry() {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { void restore() }, 3000)
    }

    async function restore() {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }

      const requestedCode = gameCodeFromSearch(window.location.search)
      const storedCode = localStorage.getItem('simple-trivia-game-code')
      if (shouldResetPlayerSessionForJoinCode(requestedCode, storedCode)) {
        clearStoredSession()
        setScreen('join')
        setRestoringSession(false)
        return
      }

      const gameId = localStorage.getItem('simple-trivia-game-id')
      const teamId = localStorage.getItem('simple-trivia-team-id')

      if (!gameId) {
        if (active) {
          setScreen('join')
          setRestoringSession(false)
        }
        return
      }

      if (!navigator.onLine) {
        if (active) setScreen('reconnecting')
        retry()
        return
      }

      const [{ data: game, error: gameError }, { data: team, error: teamError }] = await Promise.all([
        supabase
          .from('games')
          .select('status, current_screen, answer_phase, question_stage, current_question_key, current_content_screen_key')
          .eq('id', gameId)
          .maybeSingle(),
        teamId
          ? supabase.from('teams').select('id, game_id, name').eq('id', teamId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])

      if (!active) return
      if (gameError || teamError) {
        console.error('Could not restore player session:', gameError ?? teamError)
        setScreen('reconnecting')
        retry()
        return
      }

      if (!game) {
        clearStoredSession()
        setScreen('game-ended')
        setRestoringSession(false)
        return
      }

      if (!team || team.game_id !== gameId) {
        localStorage.removeItem('simple-trivia-team-id')
        localStorage.removeItem('simple-trivia-team-name')
        setScreen(gameAcceptsNewTeams(game.status) ? 'team-setup' : 'game-ended')
        setRestoringSession(false)
        return
      }

      localStorage.setItem('simple-trivia-team-name', team.name)
      const nextScreen = await resolveLivePlayerScreen(gameId, team.id, game as RemoteGameState)
      if (!active) return
      setScreen(nextScreen ?? 'game-ended')
      setRestoringSession(false)
    }

    const handleOffline = () => {
      if (!active || !localStorage.getItem('simple-trivia-game-id')) return
      setRestoringSession(true)
      setScreen('reconnecting')
    }
    const handleOnline = () => { if (active) void restore() }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    void restore()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  function go(nextScreen: PlayerScreen) {
    setScreen(nextScreen)
  }

  function leaveGame() {
    PLAYER_SESSION_KEYS.forEach(key => localStorage.removeItem(key))
    setConfirmingLeave(false)
    setRestoringSession(false)
    setScreen('join')
  }

  const canLeaveGame = screen !== 'join' && screen !== 'team-setup' && screen !== 'game-ended'

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: C.ground,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          minHeight: '100dvh',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {canLeaveGame && <PlayerPrimaryHeader onLeave={() => setConfirmingLeave(true)} />}
        <PlayerScoreVisibilityContext.Provider value={scoresVisible}>
          {renderScreen(screen, go)}
        </PlayerScoreVisibilityContext.Provider>
      </div>

      {confirmingLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#18171F]/70 px-5 backdrop-blur-sm">
          <section style={{ background: C.panel }} className="w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl">
            <h2 style={{ color: C.ink }} className="text-2xl font-black">Leave this game?</h2>
            <p style={{ color: C.sub }} className="mt-3 text-sm leading-6">
              This device will return to Join Game. Your team and score will stay in the host’s game.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmingLeave(false)}
                style={{ border: `1px solid ${C.line}`, color: C.ink }}
                className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-bold"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={leaveGame}
                style={{ background: C.stop }}
                className="flex-1 rounded-xl px-4 py-3 text-sm font-bold text-white"
              >
                Leave game
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<PlayerScreen>('join')
  const go = (s: PlayerScreen) => setScreen(s)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#2D2A3E', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* ── Prototype navigator ───────────────────────────────────────────── */}
      <div style={{
        width: 210,
        background: '#18171F',
        borderRight: '1px solid #2A2848',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
      }}>
        {/* Brand */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #2A2848' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ background: C.violet, borderRadius: 8, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ color: '#fff', fontWeight: 900, fontSize: 10 }}>ST</span>
            </div>
            <span style={{ color: '#EEE9FF', fontSize: 13, fontWeight: 700 }}>Simple Trivia</span>
          </div>
          <p style={{ color: '#7E7AA0', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Player UI · Prototype
          </p>
        </div>

        {/* Screen list */}
        <div style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SCREENS.map(s => {
            const active = s.id === screen
            return (
              <button
                key={s.id}
                onClick={() => go(s.id)}
                style={{
                  background: active ? C.violet : 'transparent',
                  color: active ? '#fff' : '#9490B8',
                  border: 'none',
                  borderRadius: 8,
                  padding: '7px 10px',
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                  fontFamily: 'inherit',
                  width: '100%',
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>

        {/* Demo flow label */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #2A2848' }}>
          <p style={{ color: '#7E7AA0', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Demo flow
          </p>
          <p style={{ color: '#4A4868', fontSize: 11, lineHeight: 1.7 }}>
            Join → Setup → Wait → Round → Answer → Submit → Reveal → Results → End
          </p>
        </div>
      </div>

      {/* ── Phone frame ───────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
      }}>
        <div style={{
          width: 390,
          height: 844,
          background: C.ground,
          borderRadius: 44,
          overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          flexShrink: 0,
        }}>
          {/* Notch bar */}
          <div style={{
            height: 44,
            background: C.panel,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            borderBottom: `1px solid ${C.line}`,
          }}>
            <div style={{ width: 120, height: 30, background: '#0C0B18', borderRadius: 999 }} />
          </div>

          {/* Screen content */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <PlayerDevControlsContext.Provider value>
              {renderScreen(screen, go)}
            </PlayerDevControlsContext.Provider>
          </div>

          {/* Home indicator */}
          <div style={{
            height: 28,
            background: C.panel,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <div style={{ width: 120, height: 4, background: C.line, borderRadius: 999 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
