"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import QRCode from "qrcode";
import { supabase } from "@/lib/supabase/client";
import QuestionsArea from "@/components/host/QuestionsArea";
import BuilderQuestionPicker, { type PickerSourceQuestion } from "@/components/host/BuilderQuestionPicker";
import BrandWordmark from "@/components/BrandWordmark";
import type { Database, Json, QuestionType } from "@/lib/supabase/database.types";
import {
  asStringArray,
  gradingPoints,
  multiAnswerMissing,
  parseStoredAnswer,
  questionOptions,
  reviewReasonLabel,
  storedSubmissionGrading,
  type ReviewStatus,
  type SubmissionGrading,
} from "@/lib/trivia/grading";
import { buildConfidentRevealResults, buildRevealResults } from "@/lib/trivia/reveal";
import {
  buildBonusRevealResults,
  buildConfidentBonusRevealResults,
  runtimeBonusFromJson,
  storedBonusGrading,
} from "@/lib/trivia/bonus-grading";
import {
  answerRevealModeFromSettings,
  type AnswerRevealMode,
} from "@/lib/trivia/answer-reveal";
import {
  leaderboardVisibilityFromSettings,
  playersSeeFinalLeaderboard,
  roundResultsScreen,
  showsLeaderboardAfterQuestion,
  type LeaderboardVisibility,
} from "@/lib/trivia/leaderboard-visibility";
import { prizeAwardsFromJson, type PrizeAward } from "@/lib/trivia/prizes";
import { correctnessSummary } from "@/lib/trivia/correctness-rate";
import { hostRecoveryScreen } from "@/lib/trivia/session-recovery";
import { buildGameJoinUrl } from "@/lib/trivia/join-code";
import {
  AUTO_BUILD_TIEBREAKER_COUNT,
  availableTiebreakerReplacements,
  closestTiebreakerTeamIds,
  isValidTiebreakerNumericValue,
  needsMoreManualTiebreakers,
} from "@/lib/trivia/tiebreakers";
import { checkQuizReadiness, quizCanHost, quizStatusFromReadiness } from "@/lib/trivia/quiz-readiness";
import {
  autoBuildSizeSummary,
  buildAutoQuizPlan,
  getAutoBuildAvailability,
  getEligibleAutoBuildTiebreakers,
  type AutoBuildAudiencePreference,
  type AutoBuildScopeMode,
} from "@/lib/trivia/auto-build";
import { draggedItemCentreY, insertionIndexWithHysteresis, moveKeyToIndex, reorderKeys, type DropPlacement } from "@/lib/trivia/builder-order";
import { isTriviaDifficulty, TRIVIA_DIFFICULTIES, triviaDifficultyTone, type TriviaDifficulty, type TriviaDifficultyTone } from "@/lib/trivia/difficulty";
import { editorialDifficultyFromLegacy, SOURCE_QUESTION_CATEGORIES } from "@/lib/trivia/question-metadata";
import { hostKeyboardNavigation, hostSpaceOverridesFocusedReviewControl, type HostKeyboardNavigation } from "@/lib/trivia/host-keyboard-navigation";
import { competitionPlacements, ordinalPlacement } from "@/lib/trivia/leaderboard-ranking";
import { loadAllSourceRows } from "@/lib/trivia/paginated-source-load";
import { nextQuizCopyTitle } from "@/lib/trivia/quiz-copy";
import { quizPreviewIndexForKey } from "@/lib/trivia/quiz-preview-navigation";
import {
  DEFAULT_SHOW_GAME_REWARD,
  showGameRewardDescription,
  showGameRewardFromSettings,
  showGameRewardSettings,
  type ShowGameRewardType,
} from "@/lib/trivia/show-game-rewards";
import {
  EMPTY_SOURCE_QUESTION_BONUS,
  estimatedQuizMinutes,
  sourceQuestionBonusDraft,
  sourceQuestionBonusPayload,
  validateSourceQuestionBonus,
} from "@/lib/trivia/source-question-bonus";
import {
  AUTO_RUN_CONTENT_SECONDS,
  AUTO_RUN_EXTENSION_SECONDS,
  autoRunAnswerSeconds,
  autoRunClockColor,
  autoRunClockLabel,
  autoRunModeFromSettings,
  autoRunRemainingAfterAllLocked,
  autoRunRevealSeconds,
  type AutoRunMode,
} from "@/lib/trivia/auto-run";
import { playerScoreVisibilityFromSettings, type PlayerScoreVisibility } from "@/lib/trivia/score-visibility";
import { teamApprovalRequiredFromSettings } from "@/lib/trivia/team-admission";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Screen =
  | 'dashboard' | 'questions' | 'recent-games' | 'create-quiz' | 'quiz-builder'
  | 'auto-build' | 'quiz-review' | 'host-setup'
  | 'lobby' | 'live-question' | 'end-of-round' | 'final-results'
type Go = (s: Screen) => void
type AutoBuildSourceQuestion = Database["public"]["Views"]["source_question_catalog"]["Row"]
type AutoBuildSourceTiebreaker = Database["public"]["Tables"]["source_tiebreakers"]["Row"]

function getHostGameCode() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('simple-trivia-host-game-code') || ''
}

function getHostGameTitle() {
  if (typeof window === 'undefined') return 'Good Trivia Company'
  return localStorage.getItem('simple-trivia-host-game-title') || 'Good Trivia Company'
}

function exitHostSession(go: Go) {
  localStorage.removeItem('simple-trivia-host-game-id')
  localStorage.removeItem('simple-trivia-host-game-code')
  localStorage.removeItem('simple-trivia-host-game-title')
  go('dashboard')
}

async function updateLiveGame(values: {
  status?: 'lobby' | 'live' | 'finished'
  current_screen?: string
  answer_phase?: 'open' | 'closed' | 'revealed'
  answer_editing_allowed?: boolean
  question_stage?: 'core' | 'bonus'
  current_question_key?: string | null
  current_content_screen_key?: string | null
  current_show_game_key?: string | null
  round_scores_finalized?: boolean
}) {
  const { error } = await supabase
    .from('games')
    .update(values)
    .eq('code', getHostGameCode())

  if (error) {
    throw error
  }
}

async function finalizeLiveGame(gameId: string) {
  const { error } = await supabase.rpc('finalize_game_with_prizes', { p_game_id: gameId })
  if (error) throw error
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
  sub: '#6B6880',
  go: '#059669',
  stop: '#DC2626',
  caution: '#D97706',
  // live dark
  liveBg: '#0C0B18',
  liveSurface: '#14122A',
  livePanel: '#1C1A35',
  liveLine: '#2A2848',
  liveText: '#EEE9FF',
  liveDim: '#7E7AA0',
  liveViolet: '#C4B5FD',
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
// ─── BASE COMPONENTS ──────────────────────────────────────────────────────────

function Btn({
  v = 'primary', sz = 'md', children, onClick, cls = '', disabled = false, hostNavigation,
}: {
  v?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'live'
  sz?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  children: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  cls?: string
  disabled?: boolean
  hostNavigation?: HostKeyboardNavigation
}) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all select-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'
  const sizes: Record<string, string> = {
    xs: 'px-2.5 py-1 text-xs',
    sm: 'px-3.5 py-2 text-sm',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3.5 text-base',
    xl: 'px-8 py-4 text-base',
  }
  const variants: Record<string, string> = {
    primary: 'bg-violet text-white hover:bg-violet-hover active:scale-[0.98] shadow-sm',
    secondary: 'bg-panel border border-line text-ink hover:bg-ground active:scale-[0.98]',
    ghost: 'bg-transparent text-sub hover:bg-violet-mist hover:text-violet active:scale-[0.98]',
    danger: 'bg-stop text-white hover:opacity-90 active:scale-[0.98]',
    live: 'bg-violet text-white text-lg font-bold hover:bg-violet-hover active:scale-[0.97] shadow-lg shadow-violet/25',
  }
  return (
    <button
      className={`${base} ${sizes[sz]} ${variants[v]} ${cls}`}
      onClick={onClick}
      disabled={disabled}
      data-host-navigation={hostNavigation}
    >
      {children}
    </button>
  )
}

function useHostKeyboardShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return

      const navigation = hostKeyboardNavigation(event.key, event.code)
      if (!navigation) return

      const eventTarget = event.target
      const focusedReviewControl = eventTarget instanceof Element
        ? eventTarget.closest<HTMLElement>('[data-host-review-control]')
        : null
      const mayAdvanceFromReviewControl = focusedReviewControl
        && hostSpaceOverridesFocusedReviewControl(event.key, event.code)
      if (eventTarget instanceof Element
        && eventTarget.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"]')
        && !mayAdvanceFromReviewControl) return
      if (document.querySelector('[data-host-shortcuts="blocked"]')) return

      const action = document.querySelector<HTMLButtonElement>(`button[data-host-navigation="${navigation}"]:not(:disabled)`)
      if (!action || action.offsetParent === null) return

      event.preventDefault()
      focusedReviewControl?.blur()
      action.click()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}

function Chip({
  children, color = 'default',
}: { children: React.ReactNode; color?: 'default' | 'ready' | 'draft' | 'very-easy' | 'easy' | 'medium' | 'hard' | 'very-hard' | 'violet' | 'live' }) {
  const colors: Record<string, string> = {
    default: 'bg-ground text-sub border border-line',
    ready: 'bg-go/10 text-go',
    draft: 'bg-caution/10 text-caution',
    'very-easy': 'bg-emerald-50 text-emerald-700',
    easy: 'bg-lime-50 text-lime-700',
    medium: 'bg-amber-50 text-amber-700',
    hard: 'bg-orange-50 text-orange-700',
    'very-hard': 'bg-red-50 text-red-700',
    violet: 'bg-violet-pale text-violet',
    live: 'bg-stop/20 text-red-400',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[color]}`}>
      {children}
    </span>
  )
}

function difficultyChipColor(difficulty: string) {
  const tone = triviaDifficultyTone(difficulty)
  return tone === 'unrated' ? 'default' as const : tone
}

const DIFFICULTY_TONE_STYLES: Record<TriviaDifficultyTone, { background: string; border: string; text: string }> = {
  'very-easy': { background: '#ecfdf5', border: '#34d399', text: '#047857' },
  easy: { background: '#f7fee7', border: '#a3e635', text: '#4d7c0f' },
  medium: { background: '#fffbeb', border: '#fbbf24', text: '#a16207' },
  hard: { background: '#fff7ed', border: '#fb923c', text: '#c2410c' },
  'very-hard': { background: '#fef2f2', border: '#f87171', text: '#b91c1c' },
}

function difficultyToneStyle(difficulty: string) {
  const tone = triviaDifficultyTone(difficulty)
  return tone === 'unrated'
    ? { background: 'white', border: C.line, text: C.sub }
    : DIFFICULTY_TONE_STYLES[tone]
}

function useGameJoinQr(gameCode: string) {
  const [qr, setQr] = useState({ dataUrl: '', joinUrl: '' })

  useEffect(() => {
    let active = true

    async function generateQr() {
      if (!gameCode) return
      const joinUrl = buildGameJoinUrl(window.location.origin, gameCode)

      try {
        const dataUrl = await QRCode.toDataURL(joinUrl, {
          width: 720,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: C.ink, light: '#FFFFFF' },
        })
        if (active) setQr({ dataUrl, joinUrl })
      } catch (error) {
        console.error('Could not create game QR code:', error)
      }
    }

    void generateQr()
    return () => { active = false }
  }, [gameCode])

  return qr
}

function QrGraphic({ dataUrl, size = 176 }: { dataUrl: string; size?: number }) {
  return (
    <div
      role="img"
      aria-label="QR code for joining this game"
      style={{
        width: size,
        height: size,
        backgroundColor: '#FFFFFF',
        backgroundImage: dataUrl ? `url(${dataUrl})` : undefined,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'contain',
      }}
      className="flex items-center justify-center rounded-2xl"
    >
      {!dataUrl && <span style={{ color: C.sub }} className="text-xs font-semibold">Creating QR…</span>}
    </div>
  )
}

function downloadGameQr(dataUrl: string, gameCode: string) {
  if (!dataUrl) return
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `simple-trivia-${gameCode}-qr.png`
  link.click()
}

type TeamJoinRequest = {
  id: string
  requested_name: string
  created_at: string
}

function useTeamJoinRequests(gameCode: string) {
  const [requests, setRequests] = useState<TeamJoinRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const loadRequests = useCallback(async (activeGameId: string) => {
    const { data, error: requestError } = await supabase
      .from('team_join_requests')
      .select('id, requested_name, created_at')
      .eq('game_id', activeGameId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (requestError) {
      console.error('Could not load team join requests:', requestError)
      setError('Could not load team requests.')
      return
    }

    setRequests(data ?? [])
    setError(null)
  }, [])

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function setup() {
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('id')
        .eq('code', gameCode)
        .maybeSingle()

      if (!active) return
      if (gameError || !game) {
        setError('Could not load team requests.')
        return
      }

      await loadRequests(game.id)
      if (!active) return

      channel = supabase
        .channel(`host-team-requests-${game.id}-${crypto.randomUUID()}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'team_join_requests', filter: `game_id=eq.${game.id}` },
          () => { void loadRequests(game.id) },
        )
        .subscribe()
    }

    void setup()
    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [gameCode, loadRequests])

  async function decide(requestId: string, decision: 'approved' | 'denied') {
    if (decidingId) return
    setDecidingId(requestId)
    setError(null)

    const { error: decisionError } = await supabase.rpc('decide_team_join_request', {
      p_request_id: requestId,
      p_decision: decision,
    })

    if (decisionError) {
      console.error('Could not decide team join request:', decisionError)
      setError('Could not update that request. Please try again.')
    } else {
      setRequests(current => current.filter(request => request.id !== requestId))
    }

    setDecidingId(null)
  }

  return { requests, error, decidingId, decide }
}

function TeamAdmissionList({
  gameCode,
  dark = false,
  compact = false,
  hideWhenEmpty = false,
  className = '',
  approvalRequired,
  approvalBusy = false,
  onApprovalRequiredChange,
}: {
  gameCode: string
  dark?: boolean
  compact?: boolean
  hideWhenEmpty?: boolean
  className?: string
  approvalRequired?: boolean
  approvalBusy?: boolean
  onApprovalRequiredChange?: (required: boolean) => void
}) {
  const { requests, error, decidingId, decide } = useTeamJoinRequests(gameCode)
  const showsApprovalToggle = approvalRequired !== undefined && onApprovalRequiredChange !== undefined

  if (!showsApprovalToggle && hideWhenEmpty && requests.length === 0 && !error) return null

  return (
    <section
      style={{
        background: dark ? C.liveSurface : C.panel,
        border: `1px solid ${dark ? C.liveLine : requests.length > 0 ? C.caution : C.line}`,
      }}
      className={`${compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-4'} text-left ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p style={{ color: dark ? C.liveText : C.ink }} className={`${compact ? 'text-xs' : 'text-sm'} font-extrabold`}>{showsApprovalToggle ? 'Approve teams before they join' : 'Pending approval'}</p>
          {!compact && <p style={{ color: dark ? C.liveDim : C.sub }} className="mt-0.5 text-xs">{showsApprovalToggle ? 'Review each team name before it appears in the game.' : 'Approve a team name before it enters the game.'}</p>}
        </div>
        {showsApprovalToggle ? (
          <button
            type="button"
            role="switch"
            aria-checked={approvalRequired}
            aria-label="Approve teams before they join"
            disabled={approvalBusy}
            onClick={() => onApprovalRequiredChange(!approvalRequired)}
            style={{ background: approvalRequired ? C.violet : C.line }}
            className="relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-wait disabled:opacity-60"
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${approvalRequired ? 'left-6' : 'left-1'}`} />
          </button>
        ) : requests.length > 0 && (
          <span style={{ background: C.caution, color: '#18171F' }} className={`rounded-full font-black ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'}`}>
            {compact ? requests.length : `${requests.length} waiting`}
          </span>
        )}
      </div>

      {approvalRequired === false && (
        <p style={{ color: dark ? C.liveDim : C.sub }} className="mt-3 rounded-xl border border-dashed border-current px-3 py-2.5 text-center text-xs">
          Teams will enter automatically.
        </p>
      )}
      {approvalRequired !== false && error && <p role="alert" style={{ color: C.stop }} className="mt-3 text-xs font-semibold">{error}</p>}
      {approvalRequired !== false && requests.length === 0 && !error && (
        <p style={{ color: dark ? C.liveDim : C.sub }} className="mt-4 rounded-xl border border-dashed border-current px-3 py-3 text-center text-xs">
          No teams are waiting for approval.
        </p>
      )}
      {approvalRequired !== false && requests.length > 0 && (
        <div className={compact ? 'mt-2 space-y-1' : 'mt-4 space-y-2'}>
          {requests.map(request => (
            <div
              key={request.id}
              style={{ background: dark ? C.livePanel : C.ground, border: `1px solid ${dark ? C.liveLine : C.line}` }}
              className={`flex items-center rounded-xl ${compact ? 'gap-1.5 px-2 py-1.5' : 'gap-3 p-3'}`}
            >
              <span style={{ color: dark ? C.liveText : C.ink }} className={`min-w-0 flex-1 truncate font-bold ${compact ? 'text-xs' : 'text-sm'}`}>{request.requested_name}</span>
              <button
                type="button"
                onClick={() => { void decide(request.id, 'denied') }}
                disabled={decidingId === request.id}
                style={{ color: C.stop, border: `1px solid ${C.stop}55` }}
                className={`cursor-pointer rounded-lg font-bold hover:bg-red-500/10 disabled:cursor-wait disabled:opacity-50 ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-2 text-xs'}`}
              >
                Deny
              </button>
              <button
                type="button"
                onClick={() => { void decide(request.id, 'approved') }}
                disabled={decidingId === request.id}
                style={{ background: C.go, color: '#FFFFFF' }}
                className={`cursor-pointer rounded-lg font-bold hover:opacity-90 disabled:cursor-wait disabled:opacity-50 ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-2 text-xs'}`}
              >
                Approve
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function JoinCodeButton({
  dark = false,
  label,
  className = '',
}: {
  dark?: boolean
  label?: string
  className?: string
}) {
  const gameCode = getHostGameCode()
  const [open, setOpen] = useState(false)
  const { dataUrl, joinUrl } = useGameJoinQr(gameCode)
  const { requests } = useTeamJoinRequests(gameCode)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ border: `1px solid ${dark ? C.liveLine : C.line}`, color: dark ? C.liveText : C.ink }}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors hover:border-violet hover:text-violet ${className}`}
      >
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0">
          <rect x="0.75" y="0.75" width="4.25" height="4.25" rx="0.6" stroke="currentColor" strokeWidth="1.5" />
          <rect x="8" y="0.75" width="4.25" height="4.25" rx="0.6" stroke="currentColor" strokeWidth="1.5" />
          <rect x="0.75" y="8" width="4.25" height="4.25" rx="0.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 8h1.5v1.5H8zM10.75 8h1.5v4.25H10.75zM8 10.75h1.5v1.5H8z" fill="currentColor" />
        </svg>
        {label ?? `Join code ${gameCode}`}
        {requests.length > 0 && (
          <span style={{ background: C.caution, color: '#18171F' }} className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-black">
            {requests.length}
          </span>
        )}
      </button>

      {open && (
        <div data-host-shortcuts="blocked" className="fixed inset-0 z-[100] overflow-y-auto bg-[#080713]/80 backdrop-blur-sm">
          <div className="flex min-h-full items-start justify-center px-4 py-4 sm:items-center sm:px-5 sm:py-8">
            <section style={{ background: C.panel }} className="w-full max-w-lg rounded-3xl p-7 text-center shadow-2xl">
            <div className="flex items-start justify-between gap-4 text-left">
              <div>
                <p style={{ color: C.violet }} className="text-xs font-extrabold uppercase tracking-widest">Join this game</p>
                <h2 style={{ color: C.ink }} className="mt-1 text-2xl font-black">Scan or enter the code</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ color: C.sub }} className="rounded-lg p-2 text-xl hover:bg-ground" aria-label="Close join code">×</button>
            </div>

            <div className="mt-7 flex justify-center">
              <QrGraphic dataUrl={dataUrl} size={280} />
            </div>
            <p style={{ color: C.sub }} className="mt-6 text-xs font-bold uppercase tracking-widest">Game code</p>
            <p style={{ color: C.ink, letterSpacing: '0.16em' }} className="mt-1 text-5xl font-black tabular-nums">{gameCode}</p>
            <p style={{ color: C.sub }} className="mt-4 break-all text-xs">{joinUrl}</p>
            <p style={{ color: C.caution }} className="mt-4 text-xs font-semibold">New teams can join while the game is running.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Btn v="secondary" onClick={() => downloadGameQr(dataUrl, gameCode)} disabled={!dataUrl}>Download QR</Btn>
              <Btn onClick={() => setOpen(false)}>Done</Btn>
            </div>
            </section>
          </div>
        </div>
      )}
    </>
  )
}

function CancelGameButton({
  go,
  dark = false,
  className = '',
  description,
}: {
  go: Go
  dark?: boolean
  className?: string
  description?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    if (cancelling) return
    setCancelling(true)
    setError(null)

    const { error: cancelError } = await supabase.rpc('cancel_host_game', {
      p_game_code: getHostGameCode(),
    })

    if (cancelError) {
      console.error('Could not cancel game:', cancelError)
      setError('Could not cancel the game. Please try again.')
      setCancelling(false)
      return
    }

    exitHostSession(go)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{ color: dark ? '#FCA5A5' : C.stop }}
        className={`rounded-lg px-3 py-2 font-bold transition-colors hover:bg-red-500/10 ${description ? 'text-left text-sm' : 'text-xs'} ${className}`}
      >
        <span className="block">Cancel game</span>
        {description && <span className="mt-0.5 block text-[10px] font-medium opacity-70">{description}</span>}
      </button>

      {confirming && (
        <div data-host-shortcuts="blocked" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#080713]/80 px-5 backdrop-blur-sm">
          <section style={{ background: C.panel }} className="w-full max-w-md rounded-3xl p-7 text-center shadow-2xl">
            <div style={{ background: '#FEF2F2', color: C.stop }} className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl">!</div>
            <h2 style={{ color: C.ink }} className="mt-5 text-2xl font-black">Cancel this game?</h2>
            <p style={{ color: C.sub }} className="mt-3 text-sm leading-6">
              The game will end immediately for every player. Scores and answers will stay saved, but the session cannot be resumed.
            </p>
            {error && <p style={{ color: C.stop }} className="mt-4 text-sm font-semibold">{error}</p>}
            <div className="mt-7 flex gap-3">
              <Btn v="secondary" cls="flex-1" onClick={() => { setConfirming(false); setError(null) }} disabled={cancelling}>Keep playing</Btn>
              <Btn v="danger" cls="flex-1" onClick={handleCancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Cancel game'}</Btn>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const I = {
  back: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  down: ({ r = false }: { r?: boolean }) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={r ? '-rotate-90 transition-transform' : 'transition-transform'}><path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  grip: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="3.5" y="2" width="2" height="2" rx="1"/><rect x="8.5" y="2" width="2" height="2" rx="1"/><rect x="3.5" y="6" width="2" height="2" rx="1"/><rect x="8.5" y="6" width="2" height="2" rx="1"/><rect x="3.5" y="10" width="2" height="2" rx="1"/><rect x="8.5" y="10" width="2" height="2" rx="1"/></svg>,
  pencil: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8.5 2.5l2 2L3 12H1v-2l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  refresh: () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><polyline points="12,1 12.5,4.7 9,5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  browse: () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  copy: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3 3h6.5M3 9.5V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  trash: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5h9M5 3.5V2.5h3v1M5.5 5.5v4M7.5 5.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M3 3.5l.6 7h5.8l.6-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  check: (sz = 16) => <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  x: (sz = 16) => <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  alert: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 4.5v4M7.5 10.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  info: () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 7v4M7.5 5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  star: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.8 3.6 4 .6-2.9 2.8.7 4L8 11l-3.6 2 .7-4L2.2 6.2l4-.6L8 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>,
  plus: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  menu: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3.5" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="12.5" r="1.3"/></svg>,
}

function IBtn({ icon, title, onClick, danger = false }: {
  icon: React.ReactNode; title: string; onClick?: () => void; danger?: boolean
}) {
  return (
    <button
      title={title} onClick={onClick}
      className={`p-2 rounded-lg transition-colors ${danger
        ? 'text-sub hover:bg-stop/10 hover:text-stop'
        : 'text-sub hover:bg-violet-mist hover:text-violet'}`}
    >
      {icon}
    </button>
  )
}

// ─── NAV ──────────────────────────────────────────────────────────────────────

function Nav({ go, active = 'My Quizzes' }: { go: Go; active?: string }) {
  return (
    <nav style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}
      className="sticky top-0 z-40 flex h-14 items-center gap-2 px-3 sm:gap-6 sm:px-6">
      <button onClick={() => go('dashboard')} aria-label="Good Trivia Company home" className="mr-0 flex shrink-0 items-center gap-2.5 sm:mr-3">
        <BrandWordmark compact className="text-[12px] sm:text-[15px]" />
      </button>
      <div className="flex items-center gap-0.5 flex-1">
        {[
          { label: 'My Quizzes', screen: 'dashboard' as Screen },
          { label: 'Questions', screen: 'questions' as Screen },
          { label: 'Recent Games', screen: 'recent-games' as Screen },
        ].map(({ label, screen }) => (
          <button
            key={label}
            onClick={() => go(screen)}
            className="relative rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:px-3.5 sm:text-sm"
            style={{ color: active === label ? C.violet : C.sub }}
          >
            {label}
            {active === label && (
              <span style={{ background: C.violet }} className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full sm:left-3.5 sm:right-3.5" />
            )}
          </button>
        ))}
      </div>
      <div style={{ background: C.violet }} className="hidden h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white transition-opacity hover:opacity-90 sm:flex">
        JH
      </div>
    </nav>
  )
}

function QuestionsScreen({ go }: { go: Go }) {
  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <Nav go={go} active="Questions" />
      <QuestionsArea />
    </div>
  )
}

type RecentGameSummary = {
  id: string
  code: string
  title: string
  status: string
  current_screen: string
  answer_phase: string
  created_at: string
  quiz_id: string | null
  team_count: number
}

function formatGameDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function RecentGamesScreen({ go }: { go: Go }) {
  const [games, setGames] = useState<RecentGameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadRecentGames() {
      setLoading(true)
      setLoadError(null)

      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (!active) return
      if (authError || !authData.user) {
        setLoadError('Could not verify your host account.')
        setLoading(false)
        return
      }

      const { data: ownedQuizzes, error: quizError } = await supabase
        .from('quizzes')
        .select('id')
        .eq('owner_id', authData.user.id)

      if (!active) return
      if (quizError) {
        console.error('Could not load owned quizzes for game history:', quizError)
        setLoadError('Could not load recent games.')
        setLoading(false)
        return
      }

      const quizIds = (ownedQuizzes ?? []).map(quiz => quiz.id)
      if (quizIds.length === 0) {
        setGames([])
        setLoading(false)
        return
      }

      const { data: gameRows, error: gameError } = await supabase
        .from('games')
        .select('id, code, title, status, current_screen, answer_phase, created_at, quiz_id')
        .in('quiz_id', quizIds)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!active) return
      if (gameError) {
        console.error('Could not load recent games:', gameError)
        setLoadError('Could not load recent games.')
        setLoading(false)
        return
      }

      const gameIds = (gameRows ?? []).map(game => game.id)
      const teamResult = gameIds.length > 0
        ? await supabase.from('teams').select('game_id').in('game_id', gameIds)
        : { data: [], error: null }

      if (!active) return
      if (teamResult.error) console.error('Could not load recent game team counts:', teamResult.error)

      const teamCounts = new Map<string, number>()
      for (const team of teamResult.data ?? []) {
        teamCounts.set(team.game_id, (teamCounts.get(team.game_id) ?? 0) + 1)
      }

      setGames((gameRows ?? []).map(game => ({
        ...game,
        team_count: teamCounts.get(game.id) ?? 0,
      })))
      setLoading(false)
    }

    void loadRecentGames()
    return () => { active = false }
  }, [])

  function openGame(game: RecentGameSummary) {
    localStorage.setItem('simple-trivia-host-game-id', game.id)
    localStorage.setItem('simple-trivia-host-game-code', game.code)
    localStorage.setItem('simple-trivia-host-game-title', game.title)
    go(hostRecoveryScreen(game.status, game.current_screen))
  }

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <Nav go={go} active="Recent Games" />
      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 style={{ color: C.ink }} className="text-3xl font-extrabold">Recent Games</h1>
          <p style={{ color: C.sub }} className="mt-2 text-sm">Resume an active session or revisit completed results.</p>
        </div>

        {loadError && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA' }} className="rounded-xl px-4 py-3 mb-5">
            <p style={{ color: C.stop }} className="text-sm font-semibold">{loadError}</p>
          </div>
        )}

        {loading ? (
          <div style={{ color: C.sub }} className="py-24 text-center text-sm">Loading recent games…</div>
        ) : games.length === 0 ? (
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-3xl px-6 py-20 text-center">
            <h2 style={{ color: C.ink }} className="text-xl font-bold">No games hosted yet</h2>
            <p style={{ color: C.sub }} className="mt-2 text-sm">Your live and completed games will appear here.</p>
            <Btn cls="mt-6" onClick={() => go('dashboard')}>Choose a Quiz</Btn>
          </div>
        ) : (
          <div className="space-y-3">
            {games.map(game => {
              const live = game.status === 'live'
              const lobby = game.status === 'lobby'
              const finished = game.status === 'finished'
              const cancelled = game.status === 'cancelled'
              const label = lobby ? 'Lobby' : live ? 'Live' : finished ? 'Completed' : cancelled ? 'Cancelled' : game.status
              const action = lobby ? 'Return to Lobby' : live ? 'Resume Game' : finished ? 'View Results' : 'Open Game'
              const badgeStyle = lobby
                ? { background: '#FFFBEB', color: '#B45309' }
                : live
                  ? { background: '#FEF2F2', color: C.stop }
                  : cancelled
                    ? { background: C.ground, color: C.sub }
                    : { background: '#F0FDF4', color: C.go }

              return (
                <article key={game.id} style={{ background: C.panel, border: `1px solid ${C.line}` }} className="flex flex-col gap-5 rounded-2xl p-5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 style={{ color: C.ink }} className="truncate text-base font-bold">{game.title}</h2>
                      <span style={badgeStyle} className="rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide">{label}</span>
                    </div>
                    <p style={{ color: C.sub }} className="mt-2 text-sm">
                      Code {game.code} · {game.team_count} team{game.team_count === 1 ? '' : 's'} · {formatGameDate(game.created_at)}
                    </p>
                  </div>
                  {cancelled ? (
                    <span style={{ color: C.sub }} className="shrink-0 px-3 py-2 text-sm font-semibold">Session ended</span>
                  ) : (
                    <Btn v={finished ? 'secondary' : 'primary'} onClick={() => openGame(game)} cls="shrink-0">{action}</Btn>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

// ─── SCREEN 1: DASHBOARD ──────────────────────────────────────────────────────

type QuizSummary = {
  id: string
  title: string
  status: 'draft' | 'ready'
  round_count: number
  question_count: number
  estimated_minutes: number
  updated_at: string
}

function formatEditedAt(value: string) {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const mins = Math.max(0, Math.round(diffMs / 60000))

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function Dashboard({ go }: { go: Go }) {
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])
  const [gamesHosted, setGamesHosted] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<QuizSummary | null>(null)
  const [deletingQuiz, setDeletingQuiz] = useState(false)
  const [pendingRename, setPendingRename] = useState<QuizSummary | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renamingQuiz, setRenamingQuiz] = useState(false)
  const [duplicatingQuizId, setDuplicatingQuizId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadDashboard() {
      setLoading(true)
      setLoadError(null)

      const [quizResult, gameCountResult] = await Promise.all([
        supabase
          .from('quizzes')
          .select('id, title, status, round_count, question_count, estimated_minutes, updated_at')
          .order('updated_at', { ascending: false }),
        supabase
          .from('games')
          .select('id', { count: 'exact', head: true }),
      ])

      if (!active) return

      if (quizResult.error) {
        console.error('Could not load quizzes:', quizResult.error)
        setLoadError('Could not load your quizzes.')
      } else {
        setQuizzes((quizResult.data ?? []) as QuizSummary[])
      }

      if (!gameCountResult.error) {
        setGamesHosted(gameCountResult.count ?? 0)
      }

      setLoading(false)
    }

    void loadDashboard()
    return () => { active = false }
  }, [])

  async function deleteQuiz(quiz: QuizSummary) {
    setDeletingQuiz(true)
    const { error } = await supabase.from('quizzes').delete().eq('id', quiz.id)
    if (error) {
      console.error('Could not delete quiz:', error)
      setLoadError('Could not delete that quiz. Please try again.')
      setDeletingQuiz(false)
      return
    }

    setQuizzes(current => current.filter(item => item.id !== quiz.id))
    setPendingDelete(null)
    setDeletingQuiz(false)
    if (localStorage.getItem('simple-trivia-selected-quiz-id') === quiz.id) {
      localStorage.removeItem('simple-trivia-selected-quiz-id')
      localStorage.removeItem('simple-trivia-selected-quiz-title')
    }
  }

  function openRename(quiz: QuizSummary) {
    setLoadError(null)
    setActionNotice(null)
    setPendingRename(quiz)
    setRenameTitle(quiz.title)
  }

  async function renameQuiz() {
    if (!pendingRename || renamingQuiz) return
    const nextTitle = renameTitle.trim()
    if (!nextTitle) {
      setLoadError('Enter a quiz name before saving.')
      return
    }

    setRenamingQuiz(true)
    setLoadError(null)
    const updatedAt = new Date().toISOString()
    const { error } = await supabase
      .from('quizzes')
      .update({ title: nextTitle, updated_at: updatedAt })
      .eq('id', pendingRename.id)

    if (error) {
      console.error('Could not rename quiz:', error)
      setLoadError('Could not rename that quiz. Please try again.')
      setRenamingQuiz(false)
      return
    }

    setQuizzes(current => current.map(quiz => quiz.id === pendingRename.id
      ? { ...quiz, title: nextTitle, updated_at: updatedAt }
      : quiz))
    if (localStorage.getItem('simple-trivia-selected-quiz-id') === pendingRename.id) {
      localStorage.setItem('simple-trivia-selected-quiz-title', nextTitle)
    }
    setPendingRename(null)
    setRenamingQuiz(false)
    setActionNotice(`Renamed quiz to “${nextTitle}”.`)
  }

  async function duplicateQuiz(quiz: QuizSummary) {
    if (duplicatingQuizId) return
    setDuplicatingQuizId(quiz.id)
    setLoadError(null)
    setActionNotice(null)

    const [questionResult, contentScreenResult, tiebreakerResult, showGameResult] = await Promise.all([
      supabase
        .from('quiz_questions')
        .select('question_key, position, item_position, round_number, round_position, round_question_count, round_title, prompt, category, difficulty, question_type, correct_answer, accepted_answers, options, tags, image_url, points_max, bonus, metadata_snapshot, notes, source_question_id, source_revision')
        .eq('quiz_id', quiz.id)
        .order('position', { ascending: true }),
      supabase
        .from('quiz_content_screens')
        .select('screen_key, item_position, round_number, round_title, title, body, image_url')
        .eq('quiz_id', quiz.id)
        .order('item_position', { ascending: true }),
      supabase
        .from('quiz_tiebreakers')
        .select('tiebreaker_key, position, prompt, correct_value, answer_unit, notes')
        .eq('quiz_id', quiz.id)
        .order('position', { ascending: true }),
      supabase
        .from('quiz_show_games')
        .select('show_game_key, item_position, round_number, round_title, game_type, title, settings')
        .eq('quiz_id', quiz.id)
        .order('item_position', { ascending: true }),
    ])

    const snapshotError = questionResult.error || contentScreenResult.error || tiebreakerResult.error || showGameResult.error
    if (snapshotError) {
      console.error('Could not load quiz snapshots for duplication:', snapshotError)
      setLoadError('Could not copy that quiz. Please try again.')
      setDuplicatingQuizId(null)
      return
    }

    const copyTitle = nextQuizCopyTitle(quiz.title, quizzes.map(item => item.title))
    const { data: copiedQuizId, error: copyError } = await supabase.rpc('save_quiz_with_show_games', {
      p_quiz_id: null,
      p_title: copyTitle,
      p_status: quiz.status,
      p_estimated_minutes: quiz.estimated_minutes,
      p_questions: (questionResult.data ?? []) as Json,
      p_content_screens: (contentScreenResult.data ?? []) as Json,
      p_tiebreakers: (tiebreakerResult.data ?? []) as Json,
      p_show_games: (showGameResult.data ?? []) as Json,
    })

    if (copyError || !copiedQuizId) {
      console.error('Could not duplicate quiz:', copyError)
      setLoadError('Could not copy that quiz. Please try again.')
      setDuplicatingQuizId(null)
      return
    }

    const createdAt = new Date().toISOString()
    setQuizzes(current => [{
      ...quiz,
      id: copiedQuizId,
      title: copyTitle,
      updated_at: createdAt,
    }, ...current])
    setDuplicatingQuizId(null)
    setActionNotice(`Created “${copyTitle}”.`)
  }

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <Nav go={go} active="My Quizzes" />
      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center gap-3 sm:gap-4">
          {[
            { label: 'Quizzes', value: String(quizzes.length) },
            { label: 'Games hosted', value: String(gamesHosted) },
          ].map(s => (
            <div key={s.label} style={{ background: C.panel, border: `1px solid ${C.line}` }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl">
              <span style={{ color: C.ink }} className="text-xl font-bold">{s.value}</span>
              <span style={{ color: C.sub }} className="text-sm">{s.label}</span>
            </div>
          ))}
          <div className="hidden flex-1 sm:block" />
          <Btn onClick={() => go('create-quiz')} sz="sm" cls="ml-auto sm:ml-0">
            <I.plus /> Create Quiz
          </Btn>
        </div>

        {loadError && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA' }} className="rounded-xl px-4 py-3 mb-5">
            <p style={{ color: C.stop }} className="text-sm font-semibold">{loadError}</p>
          </div>
        )}

        {actionNotice && (
          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }} className="mb-5 rounded-xl px-4 py-3">
            <p style={{ color: '#166534' }} className="text-sm font-semibold">{actionNotice}</p>
          </div>
        )}

        {loading ? (
          <div style={{ color: C.sub }} className="py-24 text-center text-sm">Loading quizzes…</div>
        ) : quizzes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <div style={{ background: C.violetPale }} className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5">
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                <rect x="5" y="3" width="24" height="28" rx="3.5" stroke={C.violet} strokeWidth="1.8"/>
                <path d="M11 12h12M11 17.5h8" stroke={C.violet} strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="24.5" cy="26" r="5.5" fill={C.violet}/>
                <path d="M22.5 26h4M24.5 24v4" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 style={{ color: C.ink }} className="text-xl font-bold mb-2">No quizzes yet</h2>
            <p style={{ color: C.sub }} className="text-sm max-w-[300px] mb-6 leading-relaxed">
              Create your first quiz, then host a fresh game session whenever you need one.
            </p>
            <Btn onClick={() => go('create-quiz')}><I.plus /> Create Quiz</Btn>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {quizzes.map(q => (
              <QuizCard
                key={q.id}
                q={q}
                go={go}
                duplicating={duplicatingQuizId === q.id}
                onRename={() => openRename(q)}
                onDuplicate={() => { void duplicateQuiz(q) }}
                onDelete={() => setPendingDelete(q)}
              />
            ))}
            <button
              onClick={() => go('create-quiz')}
              style={{ border: `2px dashed ${C.line}` }}
              className="cursor-pointer rounded-2xl flex flex-col items-center justify-center gap-2.5 min-h-[210px] group hover:border-violet transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/40"
            >
              <div style={{ background: C.violetMist }} className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors group-hover:bg-violet-pale">
                <I.plus />
              </div>
              <span style={{ color: C.sub }} className="text-sm font-semibold group-hover:text-violet transition-colors">Create Quiz</span>
            </button>
          </div>
        )}
      </main>
      {pendingDelete && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/50 px-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900">Delete quiz?</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">“{pendingDelete.title}” will be permanently removed. Existing game snapshots remain intact.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button disabled={deletingQuiz} onClick={() => setPendingDelete(null)} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Cancel</button>
              <button disabled={deletingQuiz} onClick={() => void deleteQuiz(pendingDelete)} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{deletingQuiz ? 'Deleting…' : 'Delete Quiz'}</button>
            </div>
          </section>
        </div>
      )}
      {pendingRename && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/50 px-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900">Rename quiz</h2>
            <label htmlFor="dashboard-quiz-name" className="mt-5 block text-xs font-bold uppercase tracking-wider text-zinc-500">Quiz name</label>
            <input
              id="dashboard-quiz-name"
              autoFocus
              value={renameTitle}
              onChange={event => setRenameTitle(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void renameQuiz() }}
              className="mt-2 w-full rounded-xl border border-zinc-200 px-4 py-3 text-base font-semibold text-zinc-900 outline-none focus:border-violet focus:ring-2 focus:ring-violet/20"
            />
            {loadError && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{loadError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button disabled={renamingQuiz} onClick={() => setPendingRename(null)} className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Cancel</button>
              <button disabled={renamingQuiz || !renameTitle.trim()} onClick={() => void renameQuiz()} className="rounded-xl bg-violet px-4 py-2 text-sm font-semibold text-white hover:bg-violet-hover disabled:opacity-50">{renamingQuiz ? 'Saving…' : 'Save Name'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function QuizCard({ q, go, duplicating, onRename, onDuplicate, onDelete }: {
  q: QuizSummary
  go: Go
  duplicating: boolean
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const ready = q.status === 'ready'
  const [menuOpen, setMenuOpen] = useState(false)

  function selectQuiz(next: Screen) {
    localStorage.setItem('simple-trivia-selected-quiz-id', q.id)
    localStorage.setItem('simple-trivia-selected-quiz-title', q.title)
    go(next)
  }

  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderLeft: `3px solid ${ready ? C.go : C.caution}`,
      }}
      className="rounded-2xl p-5 flex flex-col group hover:shadow-lg transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex min-w-0 items-start gap-1">
          <h3 style={{ color: C.ink }} className="min-w-0 truncate font-bold text-[15px] leading-snug">{q.title}</h3>
          <button type="button" aria-label={`Rename ${q.title}`} title="Rename quiz" onClick={onRename} style={{ color: C.sub }} className="shrink-0 rounded-md p-1 transition-colors hover:bg-violet-mist hover:text-violet"><I.pencil /></button>
        </div>
        <Chip color={ready ? 'ready' : 'draft'}>{ready ? 'Ready' : 'Draft'}</Chip>
      </div>
      <div style={{ color: C.sub }} className="text-sm flex items-center gap-2 mb-1">
        <span>{q.round_count} rounds</span>
        <span style={{ color: C.line }}>·</span>
        <span>{q.question_count} questions</span>
        <span style={{ color: C.line }}>·</span>
        <span>~{q.estimated_minutes} mins</span>
      </div>
      <p style={{ color: C.sub }} className="text-xs mb-auto pb-4">Edited {formatEditedAt(q.updated_at)}</p>
      <div style={{ borderTop: `1px solid ${C.line}` }} className="relative flex items-center gap-2 pt-3.5 mt-2">
        <Btn v="ghost" sz="sm" onClick={() => selectQuiz('quiz-builder')} cls="flex-1 justify-center">Edit</Btn>
        <Btn sz="sm" onClick={() => selectQuiz('host-setup')} cls="flex-1 justify-center" disabled={!ready}>Host Game</Btn>
        <button disabled={duplicating} aria-label={`Quiz actions for ${q.title}`} onClick={() => setMenuOpen(open => !open)} style={{ color: C.sub }} className="p-1.5 rounded-lg hover:bg-ground transition-colors disabled:opacity-40"><I.menu /></button>
        {menuOpen && (
          <div className="absolute bottom-10 right-0 z-20 w-44 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
            <button onClick={() => { setMenuOpen(false); onRename() }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Rename Quiz</button>
            <button onClick={() => { setMenuOpen(false); onDuplicate() }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-700 hover:bg-zinc-50">{duplicating ? 'Duplicating…' : 'Duplicate Quiz'}</button>
            <button onClick={() => { setMenuOpen(false); onDelete() }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50">Delete Quiz</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SCREEN 2: CREATE QUIZ ────────────────────────────────────────────────────

function CreateQuiz({ go }: { go: Go }) {
  const [sel, setSel] = useState<'scratch' | 'auto' | null>('auto')

  function openCreationPath(id: 'scratch' | 'auto', next: Screen) {
    if (id === 'scratch') {
      localStorage.removeItem('simple-trivia-selected-quiz-id')
      localStorage.removeItem('simple-trivia-selected-quiz-title')
    }
    go(next)
  }

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <Nav go={go} />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <button onClick={() => go('dashboard')} style={{ color: C.sub }}
          className="flex items-center gap-1.5 text-sm hover:text-violet transition-colors mb-8">
          <I.back /> My Quizzes
        </button>
        <h1 style={{ color: C.ink }} className="text-3xl font-extrabold mb-1">Create a Quiz</h1>
        <p style={{ color: C.sub }} className="mb-10">How would you like to build it?</p>

        <div className="grid grid-cols-2 gap-5 mb-8">
          {[
            {
              id: 'auto' as const,
              icon: <I.star />,
              title: 'Build it for me',
              desc: "We'll assemble a draft from the Question Library. Review and change everything in Quiz Builder.",
              cta: 'Build my quiz',
              next: 'auto-build' as Screen,
            },
            {
              id: 'scratch' as const,
              icon: <I.plus />,
              title: 'Write it myself',
              desc: 'Start with an empty quiz and choose every question yourself—from the Question Library, My Questions, or something new.',
              cta: 'Start writing',
              next: 'quiz-builder' as Screen,
            },
          ].map(opt => (
            <div
              key={opt.id}
              onClick={() => setSel(opt.id)}
              style={{
                border: `2px solid ${sel === opt.id ? C.violet : C.line}`,
                background: sel === opt.id ? C.violetMist : C.panel,
                cursor: 'pointer',
              }}
              className="text-left p-7 rounded-2xl transition-all hover:border-violet/50 hover:shadow-sm"
            >
              <div
                style={{ background: sel === opt.id ? C.violet : C.violetPale }}
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-5 transition-colors"
              >
                <span style={{ color: sel === opt.id ? 'white' : C.violet }}>{opt.icon}</span>
              </div>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 style={{ color: C.ink }} className="font-bold text-base">{opt.title}</h3>
                {opt.id === 'auto' && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">Recommended</span>}
              </div>
              <p style={{ color: C.sub }} className="text-sm leading-relaxed mb-5">{opt.desc}</p>
              <Btn
                v={sel === opt.id ? 'primary' : 'secondary'}
                sz="sm"
                onClick={(e) => { e.stopPropagation(); openCreationPath(opt.id, opt.next) }}
              >
                {opt.cta}
              </Btn>
            </div>
          ))}
        </div>

      </main>
    </div>
  )
}

// ─── SCREEN 3: QUIZ BUILDER ───────────────────────────────────────────────────

type BuilderQuestionData = {
  id: string
  questionKey: string
  text: string
  cat: string
  diff: string
  type: string
  questionType: QuestionType
  hasImage: boolean
  correctAnswer: unknown
  acceptedAnswers: unknown
  options: unknown
  tags: string[]
  imageUrl: string | null
  pointsMax: number
  bonus: Json | null
  metadataSnapshot: Json
  notes: string
  sourceQuestionId: string | null
  sourceRevision: number | null
  sourceOrigin: 'user' | 'platform' | null
  itemPosition: number
}

type BuilderContentScreenData = {
  id: string
  screenKey: string
  itemPosition: number
  title: string
  body: string
  imageUrl: string | null
}

type BuilderShowGameData = {
  id: string
  showGameKey: string
  itemPosition: number
  gameType: 'beat-the-bomb'
  title: string
  rewardType: ShowGameRewardType
  rewardPoints: number
  rewardDescription: string
  winnerMessage: string
}

type BuilderRoundData = {
  id: number
  title: string
  questions: BuilderQuestionData[]
  contentScreens: BuilderContentScreenData[]
  showGames: BuilderShowGameData[]
}

type BuilderTiebreakerData = {
  id: string
  tiebreakerKey: string
  sourceTiebreakerId: string | null
  prompt: string
  correctValue: string
  answerUnit: string
  notes: string
}

function blankBuilderTiebreaker(): BuilderTiebreakerData {
  return {
    id: `tiebreaker-${crypto.randomUUID()}`,
    tiebreakerKey: `tiebreaker-${crypto.randomUUID()}`,
    sourceTiebreakerId: null,
    prompt: '',
    correctValue: '',
    answerUnit: '',
    notes: '',
  }
}

function tiebreakerMatchKey(prompt: string, correctValue: string | number) {
  return `${prompt.trim().toLocaleLowerCase()}\u0000${String(correctValue).trim()}`
}

function questionTypeLabel(value: string) {
  const labels: Record<string, string> = {
    'single-answer': 'Single Answer',
    'image-question': 'Single Answer',
    'multiple-choice': 'Multiple Choice',
    'multi-answer': 'Multi-Answer',
    'multi-part': 'Multi-Part',
    ranking: 'Ranking',
  }
  return labels[value] ?? value
}

function editorQuestionType(value: string): QType {
  if (value === 'single-answer' || value === 'image-question') return 'single'
  if (value === 'multiple-choice' || value === 'multi-answer' || value === 'multi-part' || value === 'ranking') return value
  return 'single'
}

function prototypeEditorQuestion(type: 'single' | 'multi'): BuilderQuestionData {
  const multipleChoice = type === 'multi'
  return {
    id: `prototype-${type}`,
    questionKey: `prototype-${type}`,
    text: multipleChoice
      ? 'Which film won the Academy Award for Best Picture in 2020?'
      : 'What is the capital city of Australia?',
    cat: multipleChoice ? 'Movies' : 'Geography',
    diff: 'Medium',
    type: multipleChoice ? 'Multiple Choice' : 'Single Answer',
    questionType: multipleChoice ? 'multiple-choice' : 'single-answer',
    hasImage: false,
    correctAnswer: multipleChoice ? 'A' : 'Canberra',
    acceptedAnswers: [],
    options: multipleChoice ? [
      { key: 'A', label: 'Parasite' },
      { key: 'B', label: '1917' },
      { key: 'C', label: 'Joker' },
      { key: 'D', label: 'Once Upon a Time in Hollywood' },
    ] : null,
    tags: [],
    imageUrl: null,
    pointsMax: 1,
    bonus: null,
    metadataSnapshot: {},
    notes: '',
    sourceQuestionId: null,
    sourceRevision: null,
    sourceOrigin: null,
    itemPosition: 1,
  }
}

function blankBuilderQuestion(): BuilderQuestionData {
  return {
    id: `new-${crypto.randomUUID()}`,
    questionKey: `question-${crypto.randomUUID()}`,
    text: '',
    cat: 'Uncategorised',
    diff: 'Unrated',
    type: 'Single Answer',
    questionType: 'single-answer',
    hasImage: false,
    correctAnswer: '',
    acceptedAnswers: [],
    options: [
      { key: 'A', label: '' },
      { key: 'B', label: '' },
      { key: 'C', label: '' },
      { key: 'D', label: '' },
    ],
    tags: [],
    imageUrl: null,
    pointsMax: 1,
    bonus: null,
    metadataSnapshot: {},
    notes: '',
    sourceQuestionId: null,
    sourceRevision: null,
    sourceOrigin: null,
    itemPosition: 1,
  }
}

function sourceToBuilderQuestion(source: PickerSourceQuestion): BuilderQuestionData {
  const normalizedCategory = source.category_names.length === 1
    ? source.category_names[0]
    : source.category_names.length > 1
      ? 'Mixed categories'
      : source.category ?? 'Uncategorised'
  const normalizedDifficulty = source.editorial_difficulty
    ? TRIVIA_DIFFICULTIES[source.editorial_difficulty - 1]
    : source.difficulty ?? 'Unrated'

  return {
    id: `source-copy-${crypto.randomUUID()}`,
    questionKey: `question-${crypto.randomUUID()}`,
    text: source.prompt,
    cat: normalizedCategory,
    diff: normalizedDifficulty,
    type: questionTypeLabel(source.question_type),
    questionType: source.question_type,
    hasImage: Boolean(source.image_url),
    correctAnswer: source.correct_answer,
    acceptedAnswers: source.accepted_answers,
    options: source.options,
    tags: [...source.tag_names],
    imageUrl: source.image_url,
    pointsMax: Array.isArray(source.correct_answer) ? Math.max(1, source.correct_answer.length) : 1,
    bonus: source.bonus,
    metadataSnapshot: {
      audience_suitability: source.audience_suitability,
      audience_scope: source.audience_scope,
      audience_locale: source.audience_locale,
      content_flags: source.content_flags,
      editorial_difficulty: source.editorial_difficulty,
      stability: source.stability,
      category_ids: source.category_ids,
      tag_ids: source.tag_ids,
      bonus: source.bonus,
    },
    notes: source.notes ?? '',
    sourceQuestionId: source.id,
    sourceRevision: source.revision,
    sourceOrigin: source.origin,
    itemPosition: 1,
  }
}

function libraryReplacementFit(question: BuilderQuestionData, candidate: PickerSourceQuestion) {
  const candidateDifficulty = candidate.editorial_difficulty
    ? TRIVIA_DIFFICULTIES[candidate.editorial_difficulty - 1]
    : candidate.difficulty ?? 'Unrated'
  let score = 0

  if (candidate.category_names.some(category => category.toLocaleLowerCase() === question.cat.toLocaleLowerCase())) score += 4
  if (candidateDifficulty.toLocaleLowerCase() === question.diff.toLocaleLowerCase()) score += 2

  const currentTags = new Set(question.tags.map(tag => tag.toLocaleLowerCase()))
  score += candidate.tag_names.filter(tag => currentTags.has(tag.toLocaleLowerCase())).length
  return score
}

function nextRoundItemPosition(round: BuilderRoundData) {
  return Math.max(
    0,
    ...round.questions.map(question => question.itemPosition),
    ...round.contentScreens.map(screen => screen.itemPosition),
    ...round.showGames.map(showGame => showGame.itemPosition),
  ) + 1
}

function QuizBuilder({ go }: { go: Go }) {
  const quizTitleInputRef = useRef<HTMLInputElement>(null)
  const [quizId, setQuizId] = useState<string | null>(null)
  const [title, setTitle] = useState('Untitled Quiz')
  const [quizStatus, setQuizStatus] = useState<'draft' | 'ready'>('draft')
  const [rounds, setRounds] = useState<BuilderRoundData[]>([])
  const [tiebreakers, setTiebreakers] = useState<BuilderTiebreakerData[]>([])
  const [persisted, setPersisted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [editingTiebreakerId, setEditingTiebreakerId] = useState<string | null>(null)
  const [newQuestionRoundId, setNewQuestionRoundId] = useState<number | null>(null)
  const [addMenuRoundId, setAddMenuRoundId] = useState<number | null>(null)
  const [picker, setPicker] = useState<{ roundId: number; origin: 'user' | 'platform' } | null>(null)
  const [replaceTarget, setReplaceTarget] = useState<{ roundId: number; questionId: string } | null>(null)
  const [replaceOrigin, setReplaceOrigin] = useState<'user' | 'platform' | null>(null)
  const [replacingLibraryQuestionId, setReplacingLibraryQuestionId] = useState<string | null>(null)
  const [replacingLibraryTiebreakerId, setReplacingLibraryTiebreakerId] = useState<string | null>(null)
  const [replacementError, setReplacementError] = useState<string | null>(null)
  const [tiebreakerReplacementError, setTiebreakerReplacementError] = useState<string | null>(null)
  const replacementHistoryRef = useRef(new Map<string, Set<string>>())
  const tiebreakerReplacementHistoryRef = useRef(new Map<string, Set<string>>())
  const [draggedRoundId, setDraggedRoundId] = useState<number | null>(null)
  const [roundDropTarget, setRoundDropTarget] = useState<{ id: number; placement: DropPlacement } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [pendingExit, setPendingExit] = useState<Screen | null>(null)
  const questionCount = rounds.reduce((total, round) => total + round.questions.length, 0)
  const bonusCount = rounds.reduce((total, round) => total + round.questions.filter(question => question.bonus !== null).length, 0)
  const estimatedMinutes = estimatedQuizMinutes(questionCount, bonusCount)
  const readiness = useMemo(() => checkQuizReadiness({
    title,
    rounds: rounds.map(round => ({
      questionCount: round.questions.length,
      contentScreenTitles: round.contentScreens.map(screen => screen.title),
    })),
    tiebreakers: tiebreakers.map(tiebreaker => ({
      prompt: tiebreaker.prompt,
      correctValue: tiebreaker.correctValue,
    })),
  }), [rounds, tiebreakers, title])
  const expectedQuizStatus = quizStatusFromReadiness(readiness)
  const needsStatusSync = persisted && !dirty && quizStatus !== expectedQuizStatus
  const needsSave = !persisted || dirty || needsStatusSync
  const canHost = quizCanHost({ persisted, dirty, ready: readiness.ready, status: quizStatus })

  useEffect(() => {
    if (loading || !needsSave) return

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [loading, needsSave])

  useEffect(() => {
    let active = true

    async function loadSelectedQuiz() {
      setLoading(true)
      setLoadError(null)
      const selectedId = localStorage.getItem('simple-trivia-selected-quiz-id')

      if (!selectedId) {
        if (!active) return
        setTitle('Untitled Quiz')
        setRounds([{ id: 1, title: 'Round 1', questions: [], contentScreens: [], showGames: [] }])
        setTiebreakers([])
        setQuizId(null)
        setQuizStatus('draft')
        setPersisted(false)
        setDirty(true)
        setLoading(false)
        return
      }

      const [quizResult, questionResult, contentScreenResult, tiebreakerResult, showGameResult] = await Promise.all([
        supabase
          .from('quizzes')
          .select('id, title, status')
          .eq('id', selectedId)
          .maybeSingle(),
        supabase
          .from('quiz_questions')
          .select('id, question_key, position, item_position, round_number, round_title, prompt, category, difficulty, question_type, correct_answer, accepted_answers, options, tags, image_url, points_max, bonus, metadata_snapshot, notes, source_question_id, source_revision')
          .eq('quiz_id', selectedId)
          .order('position', { ascending: true }),
        supabase
          .from('quiz_content_screens')
          .select('id, screen_key, item_position, round_number, round_title, title, body, image_url')
          .eq('quiz_id', selectedId)
          .order('item_position', { ascending: true }),
        supabase
          .from('quiz_tiebreakers')
          .select('id, tiebreaker_key, position, prompt, correct_value, answer_unit, notes')
          .eq('quiz_id', selectedId)
          .order('position', { ascending: true }),
        supabase
          .from('quiz_show_games')
          .select('id, show_game_key, item_position, round_number, round_title, game_type, title, settings')
          .eq('quiz_id', selectedId)
          .order('item_position', { ascending: true }),
      ])

      if (!active) return

      if (quizResult.error || !quizResult.data || questionResult.error || contentScreenResult.error || tiebreakerResult.error || showGameResult.error) {
        console.error('Could not load quiz builder:', quizResult.error ?? questionResult.error ?? contentScreenResult.error ?? tiebreakerResult.error ?? showGameResult.error)
        setLoadError('Could not load this quiz. Return to My Quizzes and try again.')
        setLoading(false)
        return
      }

      const { data: sourceTiebreakerRows, error: sourceTiebreakerError } = await supabase
        .from('source_tiebreakers')
        .select('id, prompt, correct_value')
        .eq('status', 'active')
        .eq('is_verified', true)
        .range(0, 199)

      if (!active) return
      if (sourceTiebreakerError) console.warn('Could not load prepared tiebreaker provenance:', sourceTiebreakerError)
      const sourceTiebreakerIdsByContent = new Map((sourceTiebreakerRows ?? []).map(row => [
        tiebreakerMatchKey(row.prompt, row.correct_value),
        row.id,
      ]))

      const sourceQuestionIds = [...new Set((questionResult.data ?? [])
        .map(row => row.source_question_id)
        .filter((id): id is string => Boolean(id)))]
      const sourceOriginsById = new Map<string, 'user' | 'platform'>()

      if (sourceQuestionIds.length > 0) {
        const { data: sourceRows, error: sourceOriginError } = await supabase
          .from('source_questions')
          .select('id, origin')
          .in('id', sourceQuestionIds)

        if (!active) return
        if (sourceOriginError) {
          console.warn('Could not load quiz question provenance:', sourceOriginError)
        } else {
          for (const sourceRow of sourceRows ?? []) sourceOriginsById.set(sourceRow.id, sourceRow.origin)
        }
      }

      const groupedRounds = new Map<number, BuilderRoundData>()
      for (const row of questionResult.data ?? []) {
        const round = groupedRounds.get(row.round_number) ?? {
          id: row.round_number,
          title: row.round_title,
          questions: [],
          contentScreens: [],
          showGames: [],
        }

        round.questions.push({
          id: row.id,
          questionKey: row.question_key,
          text: row.prompt,
          cat: row.category ?? 'Uncategorised',
          diff: row.difficulty ?? 'Unrated',
          type: questionTypeLabel(row.question_type),
          questionType: row.question_type,
          hasImage: Boolean(row.image_url),
          correctAnswer: row.correct_answer,
          acceptedAnswers: row.accepted_answers,
          options: row.options,
          tags: row.tags,
          imageUrl: row.image_url,
          pointsMax: row.points_max,
          bonus: row.bonus,
          metadataSnapshot: row.metadata_snapshot,
          notes: row.notes ?? '',
          sourceQuestionId: row.source_question_id,
          sourceRevision: row.source_revision,
          sourceOrigin: row.source_question_id ? sourceOriginsById.get(row.source_question_id) ?? null : null,
          itemPosition: row.item_position,
        })
        groupedRounds.set(row.round_number, round)
      }

      for (const row of contentScreenResult.data ?? []) {
        const round = groupedRounds.get(row.round_number) ?? {
          id: row.round_number,
          title: row.round_title,
          questions: [],
          contentScreens: [],
          showGames: [],
        }

        round.contentScreens.push({
          id: row.id,
          screenKey: row.screen_key,
          itemPosition: row.item_position,
          title: row.title,
          body: row.body ?? '',
          imageUrl: row.image_url,
        })
        groupedRounds.set(row.round_number, round)
      }

      for (const row of showGameResult.data ?? []) {
        const reward = showGameRewardFromSettings(row.settings)
        const round = groupedRounds.get(row.round_number) ?? {
          id: row.round_number,
          title: row.round_title,
          questions: [],
          contentScreens: [],
          showGames: [],
        }
        round.showGames.push({
          id: row.id,
          showGameKey: row.show_game_key,
          itemPosition: row.item_position,
          gameType: row.game_type as 'beat-the-bomb',
          title: row.title,
          rewardType: reward.type,
          rewardPoints: reward.points,
          rewardDescription: reward.description,
          winnerMessage: reward.winnerMessage,
        })
        groupedRounds.set(row.round_number, round)
      }

      setTitle(quizResult.data.title)
      setQuizId(quizResult.data.id)
      const loadedStatus = quizResult.data.status === 'ready' ? 'ready' : 'draft'
      setQuizStatus(loadedStatus)
      const loadedRounds = [...groupedRounds.values()].sort((a, b) => a.id - b.id)
      setRounds(loadedRounds.length > 0 ? loadedRounds : [{ id: 1, title: 'Round 1', questions: [], contentScreens: [], showGames: [] }])
      setTiebreakers((tiebreakerResult.data ?? []).map(row => ({
        id: row.id,
        tiebreakerKey: row.tiebreaker_key,
        sourceTiebreakerId: sourceTiebreakerIdsByContent.get(tiebreakerMatchKey(row.prompt, row.correct_value)) ?? null,
        prompt: row.prompt,
        correctValue: String(row.correct_value),
        answerUnit: row.answer_unit ?? '',
        notes: row.notes ?? '',
      })))
      setPersisted(true)
      setDirty(false)
      setLoading(false)
    }

    void loadSelectedQuiz()
    return () => { active = false }
  }, [])

  function addQuestionToRound(roundId: number, question: BuilderQuestionData) {
    setRounds(current => current.map(round => round.id === roundId
      ? { ...round, questions: [...round.questions, { ...question, itemPosition: nextRoundItemPosition(round) }] }
      : round))
    setDirty(true)
  }

  async function cycleLibraryQuestion(roundId: number, questionId: string) {
    if (replacingLibraryQuestionId) return
    const currentQuestion = rounds
      .find(round => round.id === roundId)
      ?.questions.find(question => question.id === questionId)

    if (!currentQuestion || currentQuestion.sourceOrigin !== 'platform' || !currentQuestion.sourceQuestionId) return

    setReplacingLibraryQuestionId(questionId)
    setReplacementError(null)

    const mechanic = currentQuestion.questionType === 'image-question'
      ? 'single-answer'
      : currentQuestion.questionType
    const { data, error } = await supabase
      .from('source_question_catalog')
      .select('*')
      .eq('origin', 'platform')
      .eq('status', 'active')
      .eq('mechanic', mechanic)
      .neq('id', currentQuestion.sourceQuestionId)
      .range(0, 199)

    if (error) {
      console.error('Could not replace library question:', error)
      setReplacementError('Could not find another library question. Try again in a moment.')
      setReplacingLibraryQuestionId(null)
      return
    }

    const usedSourceIds = new Set(rounds.flatMap(round => round.questions
      .map(question => question.sourceQuestionId)
      .filter((id): id is string => Boolean(id))))
    const candidates = (data ?? [])
      .filter(candidate => !usedSourceIds.has(candidate.id))
      .sort((a, b) => libraryReplacementFit(currentQuestion, b) - libraryReplacementFit(currentQuestion, a)
        || a.id.localeCompare(b.id))

    let history = replacementHistoryRef.current.get(currentQuestion.questionKey)
      ?? new Set([currentQuestion.sourceQuestionId])
    let replacement = candidates.find(candidate => !history.has(candidate.id))

    if (!replacement && candidates.length > 0) {
      history = new Set([currentQuestion.sourceQuestionId])
      replacement = candidates[0]
    }

    if (!replacement) {
      setReplacementError('There are no other unused library questions of this type yet. You can still choose one manually.')
      setReplacingLibraryQuestionId(null)
      return
    }

    history.add(replacement.id)
    replacementHistoryRef.current.set(currentQuestion.questionKey, history)
    const replacementSnapshot = sourceToBuilderQuestion(replacement)
    setRounds(current => current.map(round => round.id === roundId ? {
      ...round,
      questions: round.questions.map(question => question.id === questionId ? {
        ...replacementSnapshot,
        id: question.id,
        questionKey: question.questionKey,
        itemPosition: question.itemPosition,
      } : question),
    } : round))
    setDirty(true)
    setReplacingLibraryQuestionId(null)
  }

  async function cycleLibraryTiebreaker(tiebreakerId: string) {
    if (replacingLibraryTiebreakerId) return
    const currentTiebreaker = tiebreakers.find(tiebreaker => tiebreaker.id === tiebreakerId)
    if (!currentTiebreaker?.sourceTiebreakerId) return

    setReplacingLibraryTiebreakerId(tiebreakerId)
    setTiebreakerReplacementError(null)

    const { data, error } = await supabase
      .from('source_tiebreakers')
      .select('id, prompt, correct_value, answer_unit, notes, primary_category_id, editorial_difficulty')
      .eq('status', 'active')
      .eq('is_verified', true)
      .range(0, 199)

    if (error) {
      console.error('Could not replace prepared tiebreaker:', error)
      setTiebreakerReplacementError('Could not find another prepared tiebreaker. Try again in a moment.')
      setReplacingLibraryTiebreakerId(null)
      return
    }

    const usedSourceIds = new Set(tiebreakers
      .map(tiebreaker => tiebreaker.sourceTiebreakerId)
      .filter((id): id is string => Boolean(id)))
    const candidates = availableTiebreakerReplacements(
      data ?? [],
      currentTiebreaker.sourceTiebreakerId,
      usedSourceIds,
    )

    let history = tiebreakerReplacementHistoryRef.current.get(currentTiebreaker.tiebreakerKey)
      ?? new Set([currentTiebreaker.sourceTiebreakerId])
    let replacement = candidates.find(candidate => !history.has(candidate.id))

    if (!replacement && candidates.length > 0) {
      history = new Set([currentTiebreaker.sourceTiebreakerId])
      replacement = candidates[0]
    }

    if (!replacement) {
      setTiebreakerReplacementError('There are no other unused prepared tiebreakers available.')
      setReplacingLibraryTiebreakerId(null)
      return
    }

    history.add(replacement.id)
    tiebreakerReplacementHistoryRef.current.set(currentTiebreaker.tiebreakerKey, history)
    setTiebreakers(current => current.map(tiebreaker => tiebreaker.id === tiebreakerId ? {
      ...tiebreaker,
      sourceTiebreakerId: replacement.id,
      prompt: replacement.prompt,
      correctValue: String(replacement.correct_value),
      answerUnit: replacement.answer_unit ?? '',
      notes: replacement.notes ?? '',
    } : tiebreaker))
    setDirty(true)
    setReplacingLibraryTiebreakerId(null)
  }

  function reorderRound(draggedId: number, targetId: number, placement: DropPlacement) {
    setRounds(current => {
      const orderedIds = reorderKeys(current.map(round => String(round.id)), String(draggedId), String(targetId), placement)
      const roundsById = new Map(current.map(round => [String(round.id), round]))
      return orderedIds.map(id => roundsById.get(id)).filter((round): round is BuilderRoundData => Boolean(round))
    })
    setDirty(true)
  }

  function startRoundDrag(roundId: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    let latestTarget: { id: number; placement: DropPlacement } | null = null
    setDraggedRoundId(roundId)
    setRoundDropTarget(null)

    const updateTarget = (clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-builder-round-id]')
      const targetId = Number(target?.dataset.builderRoundId)
      if (!target || !Number.isInteger(targetId) || targetId === roundId) {
        latestTarget = null
        setRoundDropTarget(null)
        return
      }
      const bounds = target.getBoundingClientRect()
      latestTarget = { id: targetId, placement: clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' }
      setRoundDropTarget(latestTarget)
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) updateTarget(moveEvent.clientX, moveEvent.clientY)
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return
      if (finishEvent.type === 'pointerup' && latestTarget) reorderRound(roundId, latestTarget.id, latestTarget.placement)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setDraggedRoundId(null)
      setRoundDropTarget(null)
    }

    updateTarget(event.clientX, event.clientY)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  async function saveQuiz() {
    if (saving || loading) return null
    const statusToSave = expectedQuizStatus
    if (!title.trim()) {
      setSaveError('Add a quiz title before saving.')
      return null
    }
    if (rounds.some(round => round.contentScreens.some(screen => !screen.title.trim()))) {
      setSaveError('Give every content screen a title before saving.')
      return null
    }
    if (rounds.some(round => round.showGames.some(showGame => !showGame.title.trim()))) {
      setSaveError('Give every game a title before saving.')
      return null
    }
    if (rounds.some(round => round.showGames.some(showGame => showGame.rewardType === 'custom' && !showGame.rewardDescription.trim()))) {
      setSaveError('Describe the prize for every custom game reward before saving.')
      return null
    }
    if (rounds.some(round => round.showGames.some(showGame => showGame.rewardType === 'custom' && !showGame.winnerMessage.trim()))) {
      setSaveError('Add a winner message for every custom game reward before saving.')
      return null
    }
    if (tiebreakers.some(tiebreaker => !tiebreaker.prompt.trim())) {
      setSaveError('Give every tiebreaker a question before saving, or remove the unfinished tiebreaker.')
      return null
    }
    if (tiebreakers.some(tiebreaker => !isValidTiebreakerNumericValue(tiebreaker.correctValue))) {
      setSaveError('Give every tiebreaker a numeric correct answer, without words or units.')
      return null
    }

    setSaving(true)
    setSaveError(null)
    setSaveNotice(null)
    let questionPosition = 0
    let itemPosition = 0
    const snapshots: Json[] = []
    const contentScreenSnapshots: Json[] = []
    const showGameSnapshots: Json[] = []
    const tiebreakerSnapshots: Json[] = tiebreakers.map((tiebreaker, index) => ({
      tiebreaker_key: tiebreaker.tiebreakerKey,
      position: index + 1,
      prompt: tiebreaker.prompt.trim(),
      correct_value: tiebreaker.correctValue.trim(),
      answer_unit: tiebreaker.answerUnit.trim() || null,
      notes: tiebreaker.notes.trim() || null,
    }))

    rounds.forEach((round, roundIndex) => {
      const roundQuestionCount = round.questions.length
      let roundQuestionPosition = 0
      const items = [
        ...round.questions.map(question => ({ kind: 'question' as const, itemPosition: question.itemPosition, question })),
        ...round.contentScreens.map(screen => ({ kind: 'content' as const, itemPosition: screen.itemPosition, screen })),
        ...round.showGames.map(showGame => ({ kind: 'show-game' as const, itemPosition: showGame.itemPosition, showGame })),
      ].sort((a, b) => a.itemPosition - b.itemPosition)

      items.forEach(item => {
        itemPosition += 1
        if (item.kind === 'content') {
          contentScreenSnapshots.push({
            screen_key: item.screen.screenKey,
            item_position: itemPosition,
            round_number: roundIndex + 1,
            round_title: round.title,
            title: item.screen.title.trim(),
            body: item.screen.body.trim() || null,
            image_url: item.screen.imageUrl,
          })
          return
        }
        if (item.kind === 'show-game') {
          showGameSnapshots.push({
            show_game_key: item.showGame.showGameKey,
            item_position: itemPosition,
            round_number: roundIndex + 1,
            round_title: round.title,
            game_type: item.showGame.gameType,
            title: item.showGame.title.trim(),
            settings: showGameRewardSettings({
              type: item.showGame.rewardType,
              points: item.showGame.rewardPoints,
              description: item.showGame.rewardDescription.trim(),
              winnerMessage: item.showGame.winnerMessage.trim(),
            }),
          })
          return
        }

        questionPosition += 1
        roundQuestionPosition += 1
        const question = item.question
        snapshots.push({
          question_key: question.questionKey,
          position: questionPosition,
          item_position: itemPosition,
          round_number: roundIndex + 1,
          round_position: roundQuestionPosition,
          round_question_count: roundQuestionCount,
          round_title: round.title,
          prompt: question.text,
          category: question.cat === 'Uncategorised' ? null : question.cat,
          difficulty: question.diff === 'Unrated' ? null : question.diff,
          question_type: question.questionType,
          correct_answer: question.correctAnswer as Json,
          accepted_answers: question.acceptedAnswers as Json,
          options: question.options as Json | null,
          tags: question.tags,
          image_url: question.imageUrl,
          points_max: question.pointsMax,
          bonus: question.bonus,
          metadata_snapshot: question.metadataSnapshot,
          notes: question.notes || null,
          source_question_id: question.sourceQuestionId,
          source_revision: question.sourceRevision,
        })
      })
    })

    const { data, error } = await supabase.rpc('save_quiz_with_show_games', {
      p_quiz_id: quizId,
      p_title: title.trim(),
      p_status: statusToSave,
      p_estimated_minutes: estimatedMinutes,
      p_questions: snapshots,
      p_content_screens: contentScreenSnapshots,
      p_tiebreakers: tiebreakerSnapshots,
      p_show_games: showGameSnapshots,
    })

    setSaving(false)
    if (error || !data) {
      console.error('Could not save quiz:', error)
      setSaveError('Could not save this quiz. Nothing was partially saved; try again.')
      return null
    }

    setQuizId(data)
    setPersisted(true)
    setQuizStatus(statusToSave)
    setDirty(false)
    setSaveNotice(statusToSave === 'ready'
      ? 'Saved — this quiz is ready to host.'
      : `Saved as a draft. ${readiness.blockers[0] ?? 'Finish the required quiz content before hosting.'}`)
    localStorage.setItem('simple-trivia-selected-quiz-id', data)
    localStorage.setItem('simple-trivia-selected-quiz-title', title.trim())
    return data
  }

  function hostQuiz() {
    if (!quizId || !canHost) return
    localStorage.setItem('simple-trivia-selected-quiz-id', quizId)
    localStorage.setItem('simple-trivia-selected-quiz-title', title.trim())
    go('host-setup')
  }

  function requestExit(next: Screen) {
    if (loading || !needsSave) {
      go(next)
      return
    }
    setSaveError(null)
    setPendingExit(next)
  }

  async function saveAndExit() {
    if (!pendingExit) return
    const next = pendingExit
    const savedQuizId = await saveQuiz()
    if (!savedQuizId) return
    setPendingExit(null)
    go(next)
  }

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      {/* Builder top bar */}
      <header style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}
        className="h-14 flex items-center px-6 gap-4 sticky top-0 z-40">
        <button onClick={() => requestExit('dashboard')} style={{ color: C.sub }}
          className="flex items-center gap-1.5 text-sm font-medium hover:text-violet transition-colors shrink-0">
          <I.back /> My Quizzes
        </button>
        <div className="flex-1" />
        <div style={{ color: C.sub }} className="text-xs flex items-center gap-2 shrink-0">
          <span className="font-mono">{questionCount}q</span>
          <span style={{ color: C.line }}>·</span>
          <span className="font-mono">{rounds.length}r</span>
          <span style={{ color: C.line }}>·</span>
          <span className="font-mono">~{estimatedMinutes} min</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span style={{ color: dirty || needsStatusSync ? C.caution : C.go }} className="flex items-center gap-1.5 text-xs font-semibold">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {loading ? 'Loading…' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : needsStatusSync ? 'Save to enable hosting' : persisted ? 'Saved' : 'New quiz'}
          </span>
          <Btn v="secondary" sz="sm" onClick={() => setPreviewOpen(true)}>Preview</Btn>
          <Btn
            v="secondary"
            sz="sm"
            disabled={loading || saving || !needsSave}
            onClick={() => { void saveQuiz() }}
          >
            {saving ? 'Saving…' : !persisted ? 'Save Quiz' : dirty ? 'Save Changes' : needsStatusSync ? 'Save Quiz' : 'Saved'}
          </Btn>
          <Btn
            sz="sm"
            disabled={loading || saving || !canHost}
            onClick={hostQuiz}
          >
            Host This Quiz
          </Btn>
        </div>
      </header>

      <div className="flex" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <main className="flex-1 px-6 py-7 space-y-3.5 min-w-0">
          <div className="mx-auto mb-5 flex w-full max-w-xl justify-center">
            <div
              title="Click to rename this quiz"
              style={{ border: `1px solid ${C.line}`, background: C.panel }}
              className="group flex w-full items-center gap-3 rounded-2xl px-5 py-3 shadow-sm transition-colors hover:border-violet/40 hover:bg-violet-mist"
            >
              <span style={{ color: C.sub }} className="shrink-0 text-[10px] font-extrabold uppercase tracking-wider">Quiz name</span>
              <input
                ref={quizTitleInputRef}
                aria-label="Quiz name"
                value={title}
                onChange={e => { setTitle(e.target.value); setDirty(true) }}
                style={{ color: C.ink }}
                className="min-w-0 flex-1 bg-transparent text-center text-lg font-extrabold focus:outline-none"
              />
              <button
                type="button"
                aria-label="Rename quiz"
                title="Rename quiz"
                onClick={() => { quizTitleInputRef.current?.focus(); quizTitleInputRef.current?.select() }}
                style={{ color: C.sub }}
                className="rounded-lg p-1.5 transition-colors hover:bg-violet-pale hover:text-violet group-hover:text-violet"
              ><I.pencil /></button>
            </div>
          </div>
          {!loading && !loadError && !readiness.ready && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }} className="rounded-2xl px-5 py-4">
              <p style={{ color: '#92400E' }} className="text-sm font-bold">Before you can host</p>
              <p style={{ color: '#A16207' }} className="mt-0.5 text-xs leading-5">
                {readiness.blockers[0]}
                {readiness.blockers.length > 1 ? ` ${readiness.blockers.length - 1} more item${readiness.blockers.length === 2 ? '' : 's'} also need attention.` : ''}
              </p>
            </div>
          )}
          {loadError && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: C.stop }} className="rounded-xl px-4 py-3 text-sm font-semibold">
              {loadError}
            </div>
          )}
          {saveError && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: C.stop }} className="rounded-xl px-4 py-3 text-sm font-semibold">
              {saveError}
            </div>
          )}
          {saveNotice && !dirty && (
            <div
              style={quizStatus === 'ready'
                ? { background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#166534' }
                : { background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}
              className="rounded-xl px-4 py-3 text-sm font-semibold"
            >
              {saveNotice}
            </div>
          )}
          {replacementError && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: C.stop }} className="rounded-xl px-4 py-3 text-sm font-semibold">
              {replacementError}
            </div>
          )}
          {loading && <div style={{ color: C.sub }} className="py-24 text-center text-sm">Loading quiz…</div>}
          {!loading && !loadError && rounds.map((round, roundIndex) => {
            const roundDropPlacement = roundDropTarget?.id === round.id ? roundDropTarget.placement : null
            return (
            <div
              key={round.id}
              data-builder-round-id={round.id}
              className={`relative rounded-2xl ${draggedRoundId === round.id ? 'opacity-45' : ''}`}
            >
              {roundDropPlacement === 'before' && <div className="absolute -top-1.5 left-4 right-4 z-10 h-1 rounded-full bg-violet" />}
              <BuilderRound
              round={round}
              roundNumber={roundIndex + 1}
              onEdit={questionId => setEditingQuestionId(questionId)}
              onReplace={questionId => setReplaceTarget({ roundId: round.id, questionId })}
              replacingLibraryQuestionId={replacingLibraryQuestionId}
              onCycleLibrary={questionId => void cycleLibraryQuestion(round.id, questionId)}
              onRoundPointerDown={event => startRoundDrag(round.id, event)}
              onTitleChange={nextTitle => {
                setRounds(current => current.map(item => item.id === round.id ? { ...item, title: nextTitle } : item))
                setDirty(true)
              }}
              onAddQuestion={() => setAddMenuRoundId(round.id)}
              onAddContentScreen={() => {
                setRounds(current => current.map(item => item.id === round.id ? {
                  ...item,
                  contentScreens: [...item.contentScreens, {
                    id: `content-${crypto.randomUUID()}`,
                    screenKey: `content-${crypto.randomUUID()}`,
                    itemPosition: nextRoundItemPosition(item),
                    title: 'New content screen',
                    body: '',
                    imageUrl: null,
                  }],
                } : item))
                setDirty(true)
              }}
              onAddShowGame={() => {
                setRounds(current => current.map(item => item.id === round.id ? {
                  ...item,
                  showGames: [...item.showGames, {
                    id: `show-game-${crypto.randomUUID()}`,
                    showGameKey: `show-game-${crypto.randomUUID()}`,
                    itemPosition: nextRoundItemPosition(item),
                    gameType: 'beat-the-bomb',
                    title: 'Beat the Bomb',
                    rewardType: DEFAULT_SHOW_GAME_REWARD.type,
                    rewardPoints: DEFAULT_SHOW_GAME_REWARD.points,
                    rewardDescription: DEFAULT_SHOW_GAME_REWARD.description,
                    winnerMessage: DEFAULT_SHOW_GAME_REWARD.winnerMessage,
                  }],
                } : item))
                setDirty(true)
              }}
              onUpdateContentScreen={(screenId, updates) => {
                setRounds(current => current.map(item => item.id === round.id ? {
                  ...item,
                  contentScreens: item.contentScreens.map(screen => screen.id === screenId ? { ...screen, ...updates } : screen),
                } : item))
                setDirty(true)
              }}
              onDeleteContentScreen={screenId => {
                setRounds(current => current.map(item => item.id === round.id ? {
                  ...item,
                  contentScreens: item.contentScreens.filter(screen => screen.id !== screenId),
                } : item))
                setDirty(true)
              }}
              onUpdateShowGame={(showGameId, updates) => {
                setRounds(current => current.map(item => item.id === round.id ? {
                  ...item,
                  showGames: item.showGames.map(showGame => showGame.id === showGameId ? { ...showGame, ...updates } : showGame),
                } : item))
                setDirty(true)
              }}
              onDeleteShowGame={showGameId => {
                setRounds(current => current.map(item => item.id === round.id ? {
                  ...item,
                  showGames: item.showGames.filter(showGame => showGame.id !== showGameId),
                } : item))
                setDirty(true)
              }}
              onDeleteQuestion={questionId => {
                setRounds(current => current.map(item => item.id === round.id
                  ? { ...item, questions: item.questions.filter(question => question.id !== questionId) }
                  : item))
                setDirty(true)
              }}
              onDuplicateQuestion={questionId => {
                setRounds(current => current.map(item => {
                  if (item.id !== round.id) return item
                  const source = item.questions.find(question => question.id === questionId)
                  return source ? { ...item, questions: [...item.questions, {
                    ...source,
                    id: `duplicate-${crypto.randomUUID()}`,
                    questionKey: `question-${crypto.randomUUID()}`,
                    itemPosition: nextRoundItemPosition(item),
                  }] } : item
                }))
                setDirty(true)
              }}
              onReorderItems={orderedKeys => {
                const positions = new Map(orderedKeys.map((key, index) => [key, index + 1]))
                setRounds(current => current.map(item => item.id === round.id ? {
                  ...item,
                  questions: item.questions.map(question => ({
                    ...question,
                    itemPosition: positions.get(`question:${question.id}`) ?? question.itemPosition,
                  })),
                  contentScreens: item.contentScreens.map(screen => ({
                    ...screen,
                    itemPosition: positions.get(`content:${screen.id}`) ?? screen.itemPosition,
                  })),
                  showGames: item.showGames.map(showGame => ({
                    ...showGame,
                    itemPosition: positions.get(`show-game:${showGame.id}`) ?? showGame.itemPosition,
                  })),
                } : item))
                setDirty(true)
              }}
            />
              {roundDropPlacement === 'after' && <div className="absolute -bottom-1.5 left-4 right-4 z-10 h-1 rounded-full bg-violet" />}
            </div>
          )})}
          <button
            onClick={() => {
              const nextId = Math.max(0, ...rounds.map(round => round.id)) + 1
              setRounds(current => [...current, { id: nextId, title: `Round ${nextId}`, questions: [], contentScreens: [], showGames: [] }])
              setDirty(true)
            }}
            style={{ border: `2px dashed ${C.line}` }}
            className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors hover:border-violet"
          >
            <span style={{ color: C.sub }} className="hover:text-violet transition-colors flex items-center gap-2">
              <I.plus /> Add Round
            </span>
          </button>
          <TiebreakerBuilder
            tiebreakers={tiebreakers}
            replacingId={replacingLibraryTiebreakerId}
            replacementError={tiebreakerReplacementError}
            onAdd={() => {
              const tiebreaker = blankBuilderTiebreaker()
              setTiebreakers(current => [...current, tiebreaker])
              setEditingTiebreakerId(tiebreaker.id)
              setDirty(true)
            }}
            onEdit={setEditingTiebreakerId}
            onDelete={id => {
              setTiebreakers(current => current.filter(tiebreaker => tiebreaker.id !== id))
              setDirty(true)
            }}
            onCycle={id => { void cycleLibraryTiebreaker(id) }}
            onReorder={orderedIds => {
              const byId = new Map(tiebreakers.map(tiebreaker => [tiebreaker.id, tiebreaker]))
              setTiebreakers(orderedIds.flatMap(id => {
                const tiebreaker = byId.get(id)
                return tiebreaker ? [tiebreaker] : []
              }))
              setDirty(true)
            }}
          />
        </main>

        {/* Structure sidebar */}
        <aside className={`shrink-0 px-4 py-7 transition-all ${sidebarOpen ? 'w-56' : 'w-14'}`}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }}
            className="rounded-2xl p-4 sticky top-20">
            <div className="flex items-center justify-between mb-3">
              {sidebarOpen && <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider">Quiz Structure</p>}
              <button onClick={() => setSidebarOpen(v => !v)} style={{ color: C.sub }}
                className="hover:text-ink transition-colors p-0.5 ml-auto">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d={sidebarOpen ? "M9 3L5 7l4 4" : "M5 3l4 4-4 4"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            {sidebarOpen && (
              <>
                <div className="space-y-0.5">
                  {rounds.map((round, index) => (
                    <div key={round.id} style={{ color: C.sub }}
                      className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-ground cursor-pointer transition-colors hover:text-ink text-xs">
                      <span className="truncate"><span className="font-mono opacity-60 mr-1.5">R{index + 1}</span>{round.title}</span>
                      <span className="font-mono ml-1 shrink-0">{round.questions.length}</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: `1px solid ${C.line}` }} className="mt-3 pt-3 flex justify-between text-xs">
                  <span style={{ color: C.sub }}>Total</span>
                  <span style={{ color: C.ink }} className="font-bold">{questionCount} questions</span>
                </div>
                <div className="mt-2 flex justify-between px-2 text-xs" style={{ color: C.sub }}>
                  <span>Tiebreakers</span>
                  <span className="font-mono">{tiebreakers.length}</span>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {editingQuestionId && (() => {
        const question = rounds.flatMap(round => round.questions).find(item => item.id === editingQuestionId)
        return question ? (
          <QuestionEditor
            question={question}
            onClose={() => setEditingQuestionId(null)}
            onSave={(updated) => {
              setRounds(current => current.map(round => ({
                ...round,
                questions: round.questions.map(item => item.id === updated.id ? updated : item),
              })))
              setDirty(true)
              setEditingQuestionId(null)
            }}
          />
        ) : null
      })()}

      {editingTiebreakerId && (() => {
        const tiebreaker = tiebreakers.find(item => item.id === editingTiebreakerId)
        return tiebreaker ? (
          <TiebreakerEditor
            tiebreaker={tiebreaker}
            onClose={() => setEditingTiebreakerId(null)}
            onSave={updated => {
              setTiebreakers(current => current.map(item => item.id === updated.id ? updated : item))
              setDirty(true)
              setEditingTiebreakerId(null)
            }}
          />
        ) : null
      })()}

      {addMenuRoundId !== null && (
        <AddQuestionMenu
          onClose={() => setAddMenuRoundId(null)}
          onWriteNew={() => {
            setNewQuestionRoundId(addMenuRoundId)
            setAddMenuRoundId(null)
          }}
          onPickMine={() => {
            setPicker({ roundId: addMenuRoundId, origin: 'user' })
            setAddMenuRoundId(null)
          }}
          onPickLibrary={() => {
            setPicker({ roundId: addMenuRoundId, origin: 'platform' })
            setAddMenuRoundId(null)
          }}
        />
      )}

      {picker && (
        <BuilderQuestionPicker
          origin={picker.origin}
          onClose={() => setPicker(null)}
          onSelect={source => {
            addQuestionToRound(picker.roundId, sourceToBuilderQuestion(source))
            setPicker(null)
          }}
        />
      )}

      {replaceTarget && replaceOrigin === null && (
        <ReplaceQuestionMenu
          onClose={() => setReplaceTarget(null)}
          onPickMine={() => setReplaceOrigin('user')}
          onPickLibrary={() => setReplaceOrigin('platform')}
        />
      )}

      {replaceTarget && replaceOrigin !== null && (
        <BuilderQuestionPicker
          origin={replaceOrigin}
          onClose={() => { setReplaceOrigin(null); setReplaceTarget(null) }}
          onSelect={source => {
            const replacement = sourceToBuilderQuestion(source)
            setRounds(current => current.map(round => round.id === replaceTarget.roundId ? {
              ...round,
              questions: round.questions.map(question => question.id === replaceTarget.questionId ? {
                ...replacement,
                id: question.id,
                questionKey: question.questionKey,
                itemPosition: question.itemPosition,
              } : question),
            } : round))
            setDirty(true)
            setReplaceOrigin(null)
            setReplaceTarget(null)
          }}
        />
      )}

      {newQuestionRoundId !== null && (
        <QuestionEditor
          question={blankBuilderQuestion()}
          title="Write New Question"
          onClose={() => setNewQuestionRoundId(null)}
          onSave={async question => {
            const { data: authData, error: authError } = await supabase.auth.getUser()
            if (authError || !authData.user) throw new Error('Your host session has expired.')
            const legacyCategoryAliases: Record<string, string> = {
              Movies: 'Film & Television',
              Film: 'Film & Television',
              Television: 'Film & Television',
            }
            const requestedCategory = legacyCategoryAliases[question.cat] ?? question.cat
            const [{ data: categories, error: categoryError }, { data: tags, error: tagError }] = await Promise.all([
              supabase.from('categories').select('id, name').eq('is_active', true),
              supabase.from('tags').select('id, name').eq('is_active', true),
            ])
            if (categoryError || tagError) throw categoryError ?? tagError

            const primaryCategoryId = categories?.find(category =>
              category.name.toLocaleLowerCase() === requestedCategory.toLocaleLowerCase()
            )?.id ?? null
            const requestedTags = new Set(question.tags.map(tag => tag.toLocaleLowerCase()))
            const tagIds = (tags ?? [])
              .filter(tag => requestedTags.has(tag.name.toLocaleLowerCase()))
              .map(tag => tag.id)

            const { data: sourceId, error: saveSourceError } = await supabase.rpc('save_my_question_with_inherited_metadata', {
              p_question_id: null,
              p_question: {
                question_type: question.questionType,
                prompt: question.text,
                correct_answer: question.correctAnswer as Json,
                accepted_answers: question.acceptedAnswers as Json,
                options: question.options as Json | null,
                editorial_difficulty: editorialDifficultyFromLegacy(question.diff),
                image_url: question.imageUrl,
                notes: question.notes || null,
                status: 'active',
                stability: 'stable',
                scoring_mode: question.questionType === 'multi-answer' || question.questionType === 'multi-part' || question.questionType === 'ranking'
                  ? 'per-item'
                  : 'fixed',
              },
              p_primary_category_id: primaryCategoryId,
              p_secondary_category_ids: [],
              p_tag_ids: tagIds,
              p_bonus: question.bonus,
            })
            if (saveSourceError || !sourceId) throw saveSourceError ?? new Error('Could not save source question')

            const { data: source, error: sourceError } = await supabase
              .from('source_question_catalog')
              .select('*')
              .eq('id', sourceId)
              .single()
            if (sourceError || !source) throw sourceError ?? new Error('Could not load saved source question')
            addQuestionToRound(newQuestionRoundId, sourceToBuilderQuestion(source))
            setNewQuestionRoundId(null)
          }}
        />
      )}

      {pendingExit && (
        <div data-host-shortcuts="blocked" className="fixed inset-0 z-[130] flex items-center justify-center bg-zinc-950/55 px-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-zinc-900">Save your changes?</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">This quiz has changes that haven’t been saved yet. Save them before leaving, or discard them and return to My Quizzes.</p>
            {saveError && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{saveError}</p>}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button disabled={saving} onClick={() => setPendingExit(null)} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Keep Editing</button>
              <button disabled={saving} onClick={() => { const next = pendingExit; setPendingExit(null); go(next) }} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">Discard Changes</button>
              <button disabled={saving} onClick={() => void saveAndExit()} className="rounded-xl bg-violet px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-hover disabled:opacity-50">{saving ? 'Saving…' : 'Save & Leave'}</button>
            </div>
          </section>
        </div>
      )}

      {previewOpen && <QuizPreview title={title} rounds={rounds} onClose={() => setPreviewOpen(false)} />}
    </div>
  )
}

function TiebreakerBuilder({ tiebreakers, replacingId, replacementError, onAdd, onEdit, onDelete, onCycle, onReorder }: {
  tiebreakers: BuilderTiebreakerData[]
  replacingId: string | null
  replacementError: string | null
  onAdd: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onCycle: (id: string) => void
  onReorder: (orderedIds: string[]) => void
}) {
  const belowRecommendation = needsMoreManualTiebreakers(tiebreakers.length)
  const [dragPreview, setDragPreview] = useState<{
    id: string
    offsetY: number
    originalIndex: number
    insertionIndex: number
    itemHeight: number
  } | null>(null)
  const [settlingIds, setSettlingIds] = useState<string[]>([])
  const suppressEditRef = useRef(false)
  const tiebreakerIds = tiebreakers.map(tiebreaker => tiebreaker.id)

  function dragTransform(id: string) {
    if (!dragPreview) return undefined
    if (id === dragPreview.id) return `translate3d(0, ${dragPreview.offsetY}px, 0)`
    const itemIndex = tiebreakerIds.indexOf(id)
    const distance = dragPreview.itemHeight + 10
    if (dragPreview.insertionIndex > dragPreview.originalIndex && itemIndex > dragPreview.originalIndex && itemIndex <= dragPreview.insertionIndex) {
      return `translate3d(0, -${distance}px, 0)`
    }
    if (dragPreview.insertionIndex < dragPreview.originalIndex && itemIndex >= dragPreview.insertionIndex && itemIndex < dragPreview.originalIndex) {
      return `translate3d(0, ${distance}px, 0)`
    }
    return 'translate3d(0, 0, 0)'
  }

  function startTiebreakerDrag(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const dragHandle = event.currentTarget
    if (!dragHandle.hasPointerCapture(pointerId)) dragHandle.setPointerCapture(pointerId)
    const originalIndex = tiebreakerIds.indexOf(id)
    const itemList = dragHandle.closest<HTMLElement>('[data-tiebreaker-list]')
    const itemBounds = itemList
      ? [...itemList.querySelectorAll<HTMLElement>('[data-tiebreaker-id]')]
        .map(element => ({ id: element.dataset.tiebreakerId ?? '', bounds: element.getBoundingClientRect() }))
        .filter(item => item.id)
      : []
    const draggedBounds = itemBounds.find(item => item.id === id)?.bounds
    if (originalIndex < 0 || !draggedBounds) return

    const otherItemCentres = itemBounds
      .filter(item => item.id !== id)
      .map(item => item.bounds.top + item.bounds.height / 2)
    const startX = event.clientX
    const startY = event.clientY
    let latestPointerY = startY
    let latestInsertionIndex = originalIndex
    let moved = false
    let animationFrame: number | null = null
    const insertionIndexForY = (pointerY: number) => {
      const draggedCentreY = draggedItemCentreY(draggedBounds.top, draggedBounds.height, startY, pointerY)
      return insertionIndexWithHysteresis(otherItemCentres, latestInsertionIndex, draggedCentreY)
    }
    const updatePreview = () => {
      animationFrame = null
      latestInsertionIndex = insertionIndexForY(latestPointerY)
      setDragPreview({ id, offsetY: latestPointerY - startY, originalIndex, insertionIndex: latestInsertionIndex, itemHeight: draggedBounds.height })
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      latestPointerY = moveEvent.clientY
      if (Math.hypot(moveEvent.clientX - startX, latestPointerY - startY) > 4) moved = true
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(updatePreview)
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      latestPointerY = finishEvent.clientY
      if (Math.hypot(finishEvent.clientX - startX, latestPointerY - startY) > 4) moved = true
      latestInsertionIndex = insertionIndexForY(latestPointerY)
      if (moved) {
        suppressEditRef.current = true
        window.setTimeout(() => { suppressEditRef.current = false }, 100)
      }
      if (finishEvent.type === 'pointerup' && latestInsertionIndex !== originalIndex) {
        const nextOrder = moveKeyToIndex(tiebreakerIds, id, latestInsertionIndex)
        const affectedStart = Math.min(originalIndex, latestInsertionIndex)
        const affectedEnd = Math.max(originalIndex, latestInsertionIndex)
        const affectedIds = tiebreakerIds.slice(affectedStart, affectedEnd + 1)
        flushSync(() => {
          setSettlingIds(affectedIds)
          onReorder(nextOrder)
          setDragPreview(null)
        })
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => setSettlingIds([])))
      } else {
        setDragPreview(null)
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (dragHandle.hasPointerCapture(pointerId)) dragHandle.releasePointerCapture(pointerId)
    }

    updatePreview()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <section style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 style={{ color: C.ink }} className="text-lg font-extrabold">Tiebreakers</h2>
            <span style={{ background: C.violetMist, color: C.violet }} className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Optional</span>
          </div>
          <p style={{ color: C.sub }} className="mt-1 text-xs leading-5">
            We recommend 2 closest-answer questions. Already settle ties another way? Skip these.
          </p>
        </div>
        <Btn v="secondary" sz="sm" onClick={onAdd}><I.plus /> Add Tiebreaker</Btn>
      </div>

      {tiebreakers.length === 0 ? (
        <div style={{ border: `1px dashed ${C.line}`, color: C.sub }} className="mt-3 rounded-xl px-4 py-4 text-center text-sm">
          No prepared tiebreakers. This will not prevent you from saving or hosting the quiz.
        </div>
      ) : (
        <div data-tiebreaker-list className="mt-3 space-y-2.5">
          {tiebreakers.map((tiebreaker, index) => {
            const isLibraryTiebreaker = tiebreaker.sourceTiebreakerId !== null
            const replacing = replacingId === tiebreaker.id
            return (
            <div
              key={tiebreaker.id}
              data-tiebreaker-id={tiebreaker.id}
              role="button"
              tabIndex={0}
              aria-label={`Edit tiebreaker ${index + 1}`}
              onClick={() => {
                if (!suppressEditRef.current) onEdit(tiebreaker.id)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onEdit(tiebreaker.id)
                }
              }}
              style={{
              border: `1px solid ${isLibraryTiebreaker ? '#C4B5FD' : C.line}`,
              background: isLibraryTiebreaker ? '#F7F5FF' : 'white',
              boxShadow: isLibraryTiebreaker ? `inset 3px 0 0 ${C.violet}` : undefined,
              opacity: replacing ? 0.6 : 1,
              transform: dragTransform(tiebreaker.id),
            }} className={`group relative flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 will-change-transform hover:border-violet hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-violet/25 ${dragPreview?.id === tiebreaker.id ? 'z-20 cursor-grabbing opacity-90 shadow-xl ring-2 ring-violet/25 transition-[opacity,box-shadow] duration-150' : settlingIds.includes(tiebreaker.id) ? 'transition-none' : 'transition-all duration-150 ease-out'}`}>
              <button
                type="button"
                aria-label={`Drag tiebreaker ${index + 1} to reorder`}
                title="Drag to reorder"
                onPointerDown={event => startTiebreakerDrag(tiebreaker.id, event)}
                onClick={event => event.stopPropagation()}
                style={{ color: C.sub }}
                className="mt-0.5 shrink-0 touch-none select-none cursor-grab transition-colors hover:text-ink active:cursor-grabbing"
              ><I.grip /></button>
              <div className="min-w-0 flex-1">
                {isLibraryTiebreaker && (
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-violet-700">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-100">★</span>
                    Question Library
                  </div>
                )}
                <div className="mb-2 flex items-start gap-2">
                  <span style={{ color: C.sub }} className="mt-0.5 shrink-0 font-mono text-[11px]">TB{index + 1}</span>
                  <p style={{ color: C.ink }} className="text-sm leading-snug transition-colors group-hover:text-violet">
                    {tiebreaker.prompt || 'Untitled closest-answer question'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip color="violet">Closest Answer</Chip>
                  <span style={{ color: C.violet }} className="ml-1 flex items-center gap-1 text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100">
                    <I.pencil /> Edit
                  </span>
                </div>
                <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="mt-3 rounded-lg px-3 py-2 text-xs">
                  <span style={{ color: C.go }} className="font-bold">Answer:</span>
                  <span style={{ color: C.ink }} className="ml-2 font-bold">{tiebreaker.correctValue || 'Not set'}{tiebreaker.answerUnit ? ` ${tiebreaker.answerUnit}` : ''}</span>
                  {tiebreaker.notes ? <span style={{ color: C.sub }}> · {tiebreaker.notes}</span> : null}
                </div>
              </div>
              <div className="mt-0.5 flex shrink-0 items-center gap-1" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                  {isLibraryTiebreaker && (
                    <button
                      type="button"
                      disabled={replacingId !== null}
                      onClick={() => onCycle(tiebreaker.id)}
                      title="Automatically find another unused prepared tiebreaker"
                      className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      <I.refresh /> {replacing ? 'Finding…' : 'Try another'}
                    </button>
                  )}
                  <IBtn icon={<I.trash />} title="Delete" onClick={() => onDelete(tiebreaker.id)} danger />
              </div>
            </div>
          )})}
        </div>
      )}

      {replacementError && <p style={{ color: C.stop }} className="mt-2 text-xs font-semibold">{replacementError}</p>}

      {belowRecommendation && tiebreakers.length > 0 && (
        <p style={{ color: C.caution }} className="mt-3 text-xs font-semibold">
          One is fine, but adding one more gives you a backup if teams are equally close.
        </p>
      )}
    </section>
  )
}

function TiebreakerEditor({ tiebreaker, onClose, onSave }: {
  tiebreaker: BuilderTiebreakerData
  onClose: () => void
  onSave: (tiebreaker: BuilderTiebreakerData) => void
}) {
  const [prompt, setPrompt] = useState(tiebreaker.prompt)
  const [correctValue, setCorrectValue] = useState(tiebreaker.correctValue)
  const [answerUnit, setAnswerUnit] = useState(tiebreaker.answerUnit)
  const [notes, setNotes] = useState(tiebreaker.notes)
  const [error, setError] = useState<string | null>(null)

  function save() {
    if (!prompt.trim()) {
      setError('Add the closest-answer question before saving.')
      return
    }
    if (!isValidTiebreakerNumericValue(correctValue)) {
      setError('The correct answer must be a number. Put words such as kilometres in the Unit field.')
      return
    }
    onSave({
      ...tiebreaker,
      prompt: prompt.trim(),
      correctValue: correctValue.trim(),
      answerUnit: answerUnit.trim(),
      notes: notes.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div style={{ background: 'rgba(12,11,24,0.4)' }} className="absolute inset-0 backdrop-blur-[2px]" onClick={onClose} />
      <aside style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }} className="relative flex w-[500px] flex-col shadow-2xl">
        <header style={{ borderBottom: `1px solid ${C.line}` }} className="flex shrink-0 items-center px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 style={{ color: C.ink }} className="font-extrabold">Edit Tiebreaker</h2>
            <p style={{ color: C.sub }} className="mt-0.5 text-xs">Closest numeric answer wins; this does not change trivia scores.</p>
          </div>
          <button type="button" aria-label="Close tiebreaker editor" onClick={onClose} style={{ color: C.sub }} className="p-1 transition-colors hover:text-ink">{I.x()}</button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
          <Field label="Closest-answer question">
            <textarea
              autoFocus
              rows={4}
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder="Approximately how many kilometres long is the Great Wall of China?"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full resize-none rounded-xl bg-white px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
          </Field>
          <Field label="Correct numeric answer">
            <input
              type="text"
              inputMode="decimal"
              value={correctValue}
              onChange={event => setCorrectValue(event.target.value)}
              placeholder="21196"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
          </Field>
          <Field label="Unit (optional)">
            <input
              value={answerUnit}
              onChange={event => setAnswerUnit(event.target.value)}
              placeholder="kilometres"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
          </Field>
          <Field label="Host notes (optional)">
            <textarea
              rows={3}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Source or context shown only to the host"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full resize-none rounded-xl bg-white px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
          </Field>
        </div>

        <footer style={{ borderTop: `1px solid ${C.line}` }} className="flex shrink-0 items-center justify-end gap-2 px-6 py-4">
          <Btn v="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save}>Save Tiebreaker</Btn>
        </footer>
      </aside>
    </div>
  )
}

function AddQuestionMenu({ onClose, onWriteNew, onPickMine, onPickLibrary }: {
  onClose: () => void
  onWriteNew: () => void
  onPickMine: () => void
  onPickLibrary: () => void
}) {
  const choices = [
    { title: 'Question Library', description: 'Browse platform questions and add an editable snapshot.', action: onPickLibrary },
    { title: 'My Questions', description: 'Choose one of your reusable questions and copy it into this quiz.', action: onPickMine },
    { title: 'Write New', description: 'Create a new reusable question in My Questions and add an independent quiz copy.', action: onWriteNew },
  ]

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/45 px-4 backdrop-blur-sm">
      <section className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div><h2 className="text-xl font-bold text-zinc-900">Add Question</h2><p className="mt-1 text-sm text-zinc-500">Choose where the question should come from.</p></div>
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100">Close</button>
        </div>
        <div className="space-y-3">
          {choices.map(choice => (
            <button key={choice.title} type="button" onClick={choice.action} className="w-full rounded-2xl border border-zinc-200 p-4 text-left transition hover:border-violet-300 hover:bg-violet-50">
              <span className="font-bold text-zinc-900">{choice.title}</span>
              <span className="mt-1 block text-sm leading-6 text-zinc-500">{choice.description}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function ReplaceQuestionMenu({ onClose, onPickMine, onPickLibrary }: {
  onClose: () => void
  onPickMine: () => void
  onPickLibrary: () => void
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-zinc-950/45 px-4 backdrop-blur-sm">
      <section className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div><h2 className="text-xl font-bold text-zinc-900">Replace Question</h2><p className="mt-1 text-sm text-zinc-500">Choose a reusable question to place in this position.</p></div>
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100">Close</button>
        </div>
        <div className="space-y-3">
          <button type="button" onClick={onPickLibrary} className="w-full rounded-2xl border border-zinc-200 p-4 text-left transition hover:border-violet-300 hover:bg-violet-50">
            <span className="font-bold text-zinc-900">Question Library</span>
            <span className="mt-1 block text-sm leading-6 text-zinc-500">Replace it with an editable snapshot from the platform library.</span>
          </button>
          <button type="button" onClick={onPickMine} className="w-full rounded-2xl border border-zinc-200 p-4 text-left transition hover:border-violet-300 hover:bg-violet-50">
            <span className="font-bold text-zinc-900">My Questions</span>
            <span className="mt-1 block text-sm leading-6 text-zinc-500">Replace it with an independent copy of one of your reusable questions.</span>
          </button>
        </div>
      </section>
    </div>
  )
}

function builderCorrectAnswerDisplay(question: BuilderQuestionData) {
  if (question.questionType === 'multiple-choice') {
    const key = String(question.correctAnswer ?? '')
    const match = questionOptions(question.options).find(option => option.key === key)
    return match?.label ? `${key} · ${match.label}` : key || '—'
  }

  if (Array.isArray(question.correctAnswer)) {
    return question.correctAnswer.map(item => String(item)).join(' · ') || '—'
  }

  return String(question.correctAnswer ?? '') || '—'
}

function BuilderQuestionAnswerPreview({ question }: { question: BuilderQuestionData }) {
  const correctAnswers = asStringArray(question.correctAnswer)
  const acceptedGroups = acceptedAnswerGroups(question.acceptedAnswers)
  const options = questionOptions(question.options)
  const bonus = sourceQuestionBonusDraft(question.bonus)

  return (
    <div className="mt-3 space-y-2">
      <div style={{ border: `1px solid ${C.line}`, background: C.panel }} className="rounded-lg px-3 py-2.5">
        {question.questionType === 'multiple-choice' ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {options.map((option, optionIndex) => {
              const key = option.key ?? String.fromCharCode(65 + optionIndex)
              const correct = key === String(question.correctAnswer ?? '')
              return (
                <div key={`${key}-${optionIndex}`} className="flex min-w-0 items-start gap-1.5 text-xs">
                  <span style={{ color: correct ? C.go : C.sub }} className="w-5 shrink-0 font-bold">
                    {correct ? '✓' : key}
                  </span>
                  <span style={{ color: correct ? C.ink : C.sub }} className={correct ? 'font-bold' : ''}>{option.label || '—'}</span>
                </div>
              )
            })}
          </div>
        ) : question.questionType === 'multi-part' ? (
          <div className="space-y-2">
            {correctAnswers.map((answer, index) => {
              const part = options[index]
              const aliases = acceptedGroups[index]?.filter(Boolean) ?? []
              return (
                <div key={`${part?.label ?? index}-${index}`} className="text-xs">
                  <div className="flex items-start gap-2">
                    <span style={{ color: C.violet }} className="shrink-0 font-bold">{part?.label || String.fromCharCode(65 + index)}</span>
                    <div className="min-w-0">
                      {part?.clue && <p style={{ color: C.sub }}>{part.clue}</p>}
                      <p><span style={{ color: C.go }} className="font-bold">Answer:</span> <span style={{ color: C.ink }} className="font-bold">{answer || '—'}</span></p>
                      {aliases.length > 0 && <p style={{ color: C.sub }}>Also accept: {aliases.join(' · ')}</p>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : question.questionType === 'multi-answer' ? (
          <div className="space-y-1.5">
            {correctAnswers.map((answer, index) => {
              const aliases = acceptedGroups[index]?.filter(Boolean) ?? []
              return (
                <div key={`${answer}-${index}`} className="text-xs">
                  <p style={{ color: C.ink }}><span style={{ color: C.go }} className="font-bold">{index + 1}.</span> <span className="font-bold">{answer || '—'}</span></p>
                  {aliases.length > 0 && <p style={{ color: C.sub }} className="pl-4">Also accept: {aliases.join(' · ')}</p>}
                </div>
              )
            })}
          </div>
        ) : question.questionType === 'ranking' ? (
          <div className="text-xs">
            <p style={{ color: C.go }} className="mb-1 font-bold">Correct order</p>
            <ol style={{ color: C.ink }} className="space-y-0.5 pl-4">
              {correctAnswers.map((answer, index) => <li key={`${answer}-${index}`}>{index + 1}. {answer}</li>)}
            </ol>
          </div>
        ) : (
          <div className="text-xs">
            <p><span style={{ color: C.go }} className="font-bold">Answer:</span> <span style={{ color: C.ink }} className="font-bold">{builderCorrectAnswerDisplay(question)}</span></p>
            {acceptedGroups.flat().filter(Boolean).length > 0 && (
              <p style={{ color: C.sub }} className="mt-1">Also accept: {acceptedGroups.flat().filter(Boolean).join(' · ')}</p>
            )}
          </div>
        )}
      </div>

      {bonus.enabled && (
        <div style={{ border: `1px solid ${C.violet}35`, background: C.violetMist }} className="rounded-lg px-3 py-2.5 text-xs">
          <p style={{ color: C.violet }} className="font-bold">Bonus · {bonus.points} {bonus.points === 1 ? 'point' : 'points'}</p>
          <p style={{ color: C.ink }} className="mt-1 font-semibold">{bonus.prompt || '—'}</p>
          <p style={{ color: C.sub }} className="mt-0.5"><span style={{ color: C.go }} className="font-bold">Answer:</span> {bonus.answer || '—'}</p>
        </div>
      )}
    </div>
  )
}

function QuizPreview({ title, rounds, onClose }: {
  title: string
  rounds: BuilderRoundData[]
  onClose: () => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const items = rounds.flatMap((round, roundIndex) => {
    const questionNumbers = new Map(
      [...round.questions]
        .sort((a, b) => a.itemPosition - b.itemPosition)
        .map((question, questionIndex) => [question.id, questionIndex + 1]),
    )
    return [
      ...round.questions.map(question => ({
        kind: 'question' as const,
        itemPosition: question.itemPosition,
        round,
        roundNumber: roundIndex + 1,
        roundQuestionCount: round.questions.length,
        questionNumber: questionNumbers.get(question.id) ?? 1,
        question,
      })),
      ...round.contentScreens.map(screen => ({
        kind: 'content' as const,
        itemPosition: screen.itemPosition,
        round,
        roundNumber: roundIndex + 1,
        screen,
      })),
      ...round.showGames.map(showGame => ({
        kind: 'show-game' as const,
        itemPosition: showGame.itemPosition,
        round,
        roundNumber: roundIndex + 1,
        showGame,
      })),
    ].sort((a, b) => a.itemPosition - b.itemPosition)
  })
  const active = items[activeIndex]
  const activeBonus = active?.kind === 'question' ? sourceQuestionBonusDraft(active.question.bonus) : null

  useEffect(() => {
    function handlePreviewKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return

      const nextIndex = quizPreviewIndexForKey(event.key, event.code, activeIndex, items.length)
      if (nextIndex === null) return
      event.preventDefault()
      setActiveIndex(nextIndex)
    }

    window.addEventListener('keydown', handlePreviewKeyDown)
    return () => window.removeEventListener('keydown', handlePreviewKeyDown)
  }, [activeIndex, items.length])

  return (
    <div data-host-shortcuts="blocked" className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/80 px-4 py-8 backdrop-blur-sm">
      <section className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-[#171526] text-white shadow-2xl">
        <header className="flex items-center gap-4 border-b border-white/10 px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">Player Preview</p>
            <h2 className="truncate text-lg font-bold">{title || 'Untitled Quiz'}</h2>
          </div>
          <span className="text-sm text-zinc-400">{items.length === 0 ? 'No screens yet' : `Screen ${activeIndex + 1} of ${items.length}`}</span>
          <button onClick={onClose} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/10">Close</button>
        </header>

        <div className="flex min-h-[420px] flex-1 flex-col overflow-y-auto">
          {active && (
            <div className="sticky top-0 z-10 min-h-16 shrink-0 bg-[#171526] px-8 pt-5 text-center text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
              <p>Round {active.roundNumber} · {active.round.title || 'Untitled Round'}</p>
              <p className="mt-1 text-violet-200">
                {active.kind === 'question'
                  ? `Question ${active.questionNumber} of ${active.roundQuestionCount} · ${active.question.type}`
                  : active.kind === 'content' ? 'Content Screen' : 'Game'}
              </p>
            </div>
          )}
          <div className="flex min-h-[356px] flex-1 items-center justify-center px-8 pb-8 pt-5">
            {!active ? (
              <div className="text-center"><h3 className="text-2xl font-bold">Nothing to preview yet</h3><p className="mt-2 text-zinc-400">Add a question or content screen first.</p></div>
            ) : active.kind === 'content' ? (
              <div className="w-full max-w-2xl text-center">
                {active.screen.imageUrl && <div role="img" aria-label="Content screen image" className="mx-auto mb-6 h-52 w-full rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${active.screen.imageUrl})` }} />}
                <h3 className="text-4xl font-black leading-tight">{active.screen.title || 'Untitled screen'}</h3>
                {active.screen.body && <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-zinc-300">{active.screen.body}</p>}
              </div>
            ) : active.kind === 'show-game' ? (
              <div className="w-full max-w-2xl text-center">
                <div className="text-8xl" aria-hidden="true">💣</div>
                <h3 className="mt-5 text-4xl font-black">{active.showGame.title}</h3>
                <p className="mx-auto mt-4 max-w-lg text-lg text-zinc-300">Press once. Be the last team to press before the bomb explodes.</p>
                <div className="mx-auto mt-7 max-w-xs rounded-2xl bg-violet-600 px-8 py-4 text-xl font-black">PRESS ME</div>
                <p className="mt-4 text-sm text-zinc-400">Random 10–30 second fuse</p>
                <p className="mx-auto mt-3 max-w-lg rounded-xl border border-violet-300/20 bg-violet-300/10 px-4 py-3 text-sm font-bold text-violet-100">
                  {showGameRewardDescription({
                    type: active.showGame.rewardType,
                    points: active.showGame.rewardPoints,
                    description: active.showGame.rewardDescription,
                    winnerMessage: active.showGame.winnerMessage,
                  })}
                </p>
              </div>
            ) : (
              <div className="w-full max-w-2xl">
                {active.question.imageUrl && <div role="img" aria-label="Question image" className="mb-6 h-52 w-full rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${active.question.imageUrl})` }} />}
                <h3 className="text-center text-3xl font-black leading-tight">{active.question.text}</h3>
                <div className="mx-auto mt-8 max-w-md rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-5 py-4 text-center">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">Correct answer</p>
                  <p className="mt-2 text-lg font-bold text-white">{builderCorrectAnswerDisplay(active.question)}</p>
                  {acceptedAnswerGroups(active.question.acceptedAnswers).flat().filter(Boolean).length > 0 && (
                    <p className="mt-2 text-sm text-zinc-300">
                      Also accept: {acceptedAnswerGroups(active.question.acceptedAnswers).flat().filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                {activeBonus?.enabled && (
                  <div className="mx-auto mt-4 max-w-md rounded-2xl border border-violet-300/30 bg-violet-300/10 px-5 py-4 text-center">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">Bonus · {activeBonus.points} {activeBonus.points === 1 ? 'point' : 'points'}</p>
                    <p className="mt-2 text-base font-bold text-white">{activeBonus.prompt}</p>
                    <p className="mt-2 text-sm text-violet-100">Answer: {activeBonus.answer}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="grid grid-cols-[1fr_auto_1fr] items-center border-t border-white/10 px-6 py-4">
          <button disabled={activeIndex === 0 || items.length === 0} onClick={() => setActiveIndex(index => Math.max(0, index - 1))} className="justify-self-start rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold disabled:opacity-30">← Previous</button>
          <span className="text-xs font-semibold text-zinc-500">Space / → next · ← previous</span>
          <button disabled={items.length === 0 || activeIndex >= items.length - 1} onClick={() => setActiveIndex(index => Math.min(items.length - 1, index + 1))} className="justify-self-end rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold disabled:opacity-30">Next →</button>
        </footer>
      </section>
    </div>
  )
}

function BuilderRound({ round, roundNumber, replacingLibraryQuestionId, onEdit, onReplace, onCycleLibrary, onRoundPointerDown, onTitleChange, onAddQuestion, onAddContentScreen, onAddShowGame, onDeleteQuestion, onDuplicateQuestion, onUpdateContentScreen, onDeleteContentScreen, onUpdateShowGame, onDeleteShowGame, onReorderItems }: {
  round: BuilderRoundData
  roundNumber: number
  replacingLibraryQuestionId: string | null
  onEdit: (questionId: string) => void
  onReplace: (questionId: string) => void
  onCycleLibrary: (questionId: string) => void
  onRoundPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onTitleChange: (title: string) => void
  onAddQuestion: () => void
  onAddContentScreen: () => void
  onAddShowGame: () => void
  onDeleteQuestion: (questionId: string) => void
  onDuplicateQuestion: (questionId: string) => void
  onUpdateContentScreen: (screenId: string, updates: Partial<BuilderContentScreenData>) => void
  onDeleteContentScreen: (screenId: string) => void
  onUpdateShowGame: (showGameId: string, updates: Partial<BuilderShowGameData>) => void
  onDeleteShowGame: (showGameId: string) => void
  onReorderItems: (orderedKeys: string[]) => void
}) {
  const [open, setOpen] = useState(true)
  const roundTitleInputRef = useRef<HTMLInputElement>(null)
  const [itemDragPreview, setItemDragPreview] = useState<{
    key: string
    offsetY: number
    originalIndex: number
    insertionIndex: number
    itemHeight: number
  } | null>(null)
  const [dropSettlingItemKeys, setDropSettlingItemKeys] = useState<string[]>([])
  const suppressItemEditRef = useRef(false)
  const items = [
    ...round.questions.map(question => ({ kind: 'question' as const, itemPosition: question.itemPosition, question })),
    ...round.contentScreens.map(screen => ({ kind: 'content' as const, itemPosition: screen.itemPosition, screen })),
    ...round.showGames.map(showGame => ({ kind: 'show-game' as const, itemPosition: showGame.itemPosition, showGame })),
  ].sort((a, b) => a.itemPosition - b.itemPosition)
  const itemKeys = items.map(item => item.kind === 'question'
    ? `question:${item.question.id}`
    : item.kind === 'content' ? `content:${item.screen.id}` : `show-game:${item.showGame.id}`)

  function itemDragTransform(itemKey: string) {
    if (!itemDragPreview) return undefined
    if (itemKey === itemDragPreview.key) return `translate3d(0, ${itemDragPreview.offsetY}px, 0)`

    const itemIndex = itemKeys.indexOf(itemKey)
    const distance = itemDragPreview.itemHeight + 8
    if (
      itemDragPreview.insertionIndex > itemDragPreview.originalIndex
      && itemIndex > itemDragPreview.originalIndex
      && itemIndex <= itemDragPreview.insertionIndex
    ) return `translate3d(0, -${distance}px, 0)`
    if (
      itemDragPreview.insertionIndex < itemDragPreview.originalIndex
      && itemIndex >= itemDragPreview.insertionIndex
      && itemIndex < itemDragPreview.originalIndex
    ) return `translate3d(0, ${distance}px, 0)`
    return 'translate3d(0, 0, 0)'
  }

  function startItemDrag(itemKey: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const dragHandle = event.currentTarget
    if (!dragHandle.hasPointerCapture(pointerId)) dragHandle.setPointerCapture(pointerId)
    const originalIndex = itemKeys.indexOf(itemKey)
    const itemList = event.currentTarget.closest<HTMLElement>('[data-builder-item-list]')
    const itemBounds = itemList
      ? [...itemList.querySelectorAll<HTMLElement>('[data-builder-item-key]')]
        .map(element => ({ key: element.dataset.builderItemKey ?? '', bounds: element.getBoundingClientRect() }))
        .filter(item => item.key)
      : []
    const draggedBounds = itemBounds.find(item => item.key === itemKey)?.bounds
    if (originalIndex < 0 || !draggedBounds) return

    const otherItems = itemBounds.filter(item => item.key !== itemKey)
    const startX = event.clientX
    const startY = event.clientY
    let latestPointerY = startY
    let latestInsertionIndex = originalIndex
    let moved = false
    let animationFrame: number | null = null
    const otherItemCentres = otherItems.map(item => item.bounds.top + item.bounds.height / 2)

    const insertionIndexForY = (pointerY: number) => {
      const draggedCentreY = draggedItemCentreY(draggedBounds.top, draggedBounds.height, startY, pointerY)
      return insertionIndexWithHysteresis(otherItemCentres, latestInsertionIndex, draggedCentreY)
    }

    const updatePreview = () => {
      animationFrame = null
      const insertionIndex = insertionIndexForY(latestPointerY)
      latestInsertionIndex = insertionIndex
      setItemDragPreview({
        key: itemKey,
        offsetY: latestPointerY - startY,
        originalIndex,
        insertionIndex,
        itemHeight: draggedBounds.height,
      })
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      latestPointerY = moveEvent.clientY
      if (Math.hypot(moveEvent.clientX - startX, latestPointerY - startY) > 4) moved = true
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(updatePreview)
    }
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = null
      }
      latestPointerY = finishEvent.clientY
      if (Math.hypot(finishEvent.clientX - startX, latestPointerY - startY) > 4) moved = true
      latestInsertionIndex = insertionIndexForY(latestPointerY)
      if (moved) {
        suppressItemEditRef.current = true
        window.setTimeout(() => { suppressItemEditRef.current = false }, 100)
      }
      if (finishEvent.type === 'pointerup' && latestInsertionIndex !== originalIndex) {
        const nextOrder = moveKeyToIndex(itemKeys, itemKey, latestInsertionIndex)
        const affectedStart = Math.min(originalIndex, latestInsertionIndex)
        const affectedEnd = Math.max(originalIndex, latestInsertionIndex)
        const affectedItemKeys = itemKeys.slice(affectedStart, affectedEnd + 1)
        flushSync(() => {
          setDropSettlingItemKeys(affectedItemKeys)
          onReorderItems(nextOrder)
          setItemDragPreview(null)
        })
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            setDropSettlingItemKeys(current => current.includes(itemKey) ? [] : current)
          })
        })
      } else {
        setItemDragPreview(null)
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (dragHandle.hasPointerCapture(pointerId)) dragHandle.releasePointerCapture(pointerId)
    }

    updatePreview()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl overflow-hidden">
      <div style={{ background: C.ground, borderBottom: open ? `1px solid ${C.line}` : 'none' }}
        className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-label={`Drag Round ${roundNumber} to reorder`}
          title="Drag to reorder round"
          onPointerDown={onRoundPointerDown}
          style={{ color: C.sub }}
          className="touch-none select-none cursor-grab hover:text-ink active:cursor-grabbing transition-colors"
        ><I.grip /></button>
        <span style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-widest shrink-0">Round {roundNumber}</span>
        <div
          title="Click to rename this round"
          style={{ border: `1px solid ${C.line}`, background: C.panel }}
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:border-violet/40 hover:bg-violet-mist"
        >
          <input
            ref={roundTitleInputRef}
            aria-label={`Round ${roundNumber} name`}
            value={round.title}
            onChange={e => onTitleChange(e.target.value)}
            style={{ color: C.ink }}
            className="min-w-0 flex-1 bg-transparent text-sm font-bold focus:outline-none"
          />
          <button
            type="button"
            aria-label={`Rename round ${roundNumber}`}
            title={`Rename round ${roundNumber}`}
            onClick={() => { roundTitleInputRef.current?.focus(); roundTitleInputRef.current?.select() }}
            style={{ color: C.sub }}
            className="rounded-md p-1 transition-colors hover:bg-violet-mist hover:text-violet group-hover:text-violet"
          ><I.pencil /></button>
        </div>
        <span style={{ color: C.sub }} className="text-xs font-mono">{round.questions.length}q</span>
        <button onClick={() => setOpen(o => !o)} style={{ color: C.sub }} className="hover:text-ink transition-colors p-0.5">
          <I.down r={!open} />
        </button>
      </div>
      {open && (
        <div data-builder-item-list className="p-3 space-y-2">
          {items.map(item => {
            const itemKey = item.kind === 'question'
              ? `question:${item.question.id}`
              : item.kind === 'content' ? `content:${item.screen.id}` : `show-game:${item.showGame.id}`
            const dragged = itemDragPreview?.key === itemKey
            const isSettlingAfterDrop = dropSettlingItemKeys.includes(itemKey)
            return (
            <div
              key={itemKey}
              data-builder-item-key={itemKey}
              style={{ transform: itemDragTransform(itemKey) }}
              className={`relative rounded-xl will-change-transform ${dragged ? 'z-20 cursor-grabbing opacity-90 shadow-xl ring-2 ring-violet/25 transition-[opacity,box-shadow] duration-150' : isSettlingAfterDrop ? 'transition-none' : 'transition-transform duration-150 ease-out'}`}
            >
              {item.kind === 'question' ? (
              <BuilderQuestion
              q={item.question}
              idx={round.questions.filter(question => question.itemPosition <= item.question.itemPosition).length - 1}
              onEdit={() => {
                if (!suppressItemEditRef.current) onEdit(item.question.id)
              }}
              onReplace={() => onReplace(item.question.id)}
              onCycleLibrary={() => onCycleLibrary(item.question.id)}
              replacing={replacingLibraryQuestionId === item.question.id}
              onDelete={() => onDeleteQuestion(item.question.id)}
              onDuplicate={() => onDuplicateQuestion(item.question.id)}
              onPointerDown={event => startItemDrag(itemKey, event)}
            />
          ) : item.kind === 'content' ? (
            <BuilderContentScreen
              screen={item.screen}
              onChange={updates => onUpdateContentScreen(item.screen.id, updates)}
              onDelete={() => onDeleteContentScreen(item.screen.id)}
              onPointerDown={event => startItemDrag(itemKey, event)}
            />
          ) : (
            <BuilderShowGame
              showGame={item.showGame}
              onChange={updates => onUpdateShowGame(item.showGame.id, updates)}
              onDelete={() => onDeleteShowGame(item.showGame.id)}
              onPointerDown={event => startItemDrag(itemKey, event)}
            />
          )}
            </div>
          )})}
          <div className="flex gap-1 pt-1">
            <button onClick={onAddQuestion} style={{ color: C.sub }}
              className="text-xs font-semibold px-2.5 py-2 rounded-lg hover:bg-violet-mist hover:text-violet transition-colors flex items-center gap-1.5">
              <I.plus /> Add Question
            </button>
            <button onClick={onAddContentScreen} style={{ color: C.sub }}
              className="text-xs font-semibold px-2.5 py-2 rounded-lg hover:bg-violet-mist hover:text-violet transition-colors flex items-center gap-1.5">
              <I.plus /> Add Content Screen
            </button>
            <button onClick={onAddShowGame} style={{ color: C.sub }}
              className="text-xs font-semibold px-2.5 py-2 rounded-lg hover:bg-violet-mist hover:text-violet transition-colors flex items-center gap-1.5">
              <I.plus /> Add Game
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function BuilderContentScreen({ screen, onChange, onDelete, onPointerDown }: {
  screen: BuilderContentScreenData
  onChange: (updates: Partial<BuilderContentScreenData>) => void
  onDelete: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const [expanded, setExpanded] = useState(() => screen.id.startsWith('content-'))

  return (
    <div style={{ border: `1.5px dashed ${C.violet}50`, background: `${C.violet}06` }}
      className="rounded-xl overflow-hidden">
      {/* Header row — click anywhere to expand */}
      <div className="flex items-start gap-3 px-3 py-3 group cursor-pointer hover:bg-violet/5 transition-colors"
        onClick={() => setExpanded(v => !v)}>
        <button type="button" aria-label="Drag content screen to reorder" title="Drag to reorder"
          onPointerDown={onPointerDown}
          style={{ color: C.sub }} className="mt-0.5 touch-none select-none cursor-grab hover:text-ink active:cursor-grabbing transition-colors shrink-0"
          onClick={e => e.stopPropagation()}><I.grip /></button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span style={{ background: C.violetPale, color: C.violet }}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md">Content Screen</span>
            <span style={{ color: C.sub }} className="text-[10px]">Shown to players · Not scored</span>
          </div>
          <p style={{ color: C.ink }} className="text-sm font-semibold truncate group-hover:text-violet transition-colors">
            {screen.title || 'Untitled screen'}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
          <IBtn icon={<I.trash />} title="Delete content screen" onClick={onDelete} danger />
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.violet}30`, background: `${C.violet}04` }}
          className="px-4 pb-4 pt-3 space-y-3">
          <div>
            <label style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-wider block mb-1">Title</label>
            <input
              value={screen.title}
              onChange={e => onChange({ title: e.target.value })}
              placeholder="e.g. Bar's open — back in 10 minutes!"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 placeholder:text-sub"
            />
          </div>
          <div>
            <label style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-wider block mb-1">Body Copy <span className="normal-case font-normal opacity-60">(optional)</span></label>
            <textarea
              value={screen.body}
              onChange={e => onChange({ body: e.target.value })}
              rows={2}
              placeholder="Additional text shown below the title on player screens…"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 resize-none placeholder:text-sub"
            />
          </div>
          <div>
            <label style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-wider block mb-1">Image URL <span className="normal-case font-normal opacity-60">(optional)</span></label>
            <input
              value={screen.imageUrl ?? ''}
              onChange={event => onChange({ imageUrl: event.target.value.trim() || null })}
              placeholder="https://example.com/content-image.png"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 placeholder:text-sub"
            />
          </div>
          <div className="flex justify-end">
            <button onClick={() => setExpanded(false)} style={{ color: C.violet }}
              className="text-xs font-semibold hover:opacity-70 transition-opacity">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

function BuilderShowGame({ showGame, onChange, onDelete, onPointerDown }: {
  showGame: BuilderShowGameData
  onChange: (updates: Partial<BuilderShowGameData>) => void
  onDelete: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const [expanded, setExpanded] = useState(() => showGame.id.startsWith('show-game-'))

  return (
    <div style={{ border: `1.5px solid ${C.violet}55`, background: C.violetMist }} className="rounded-xl overflow-hidden">
      <div className="group flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-violet/5" onClick={() => setExpanded(value => !value)}>
        <button type="button" aria-label="Drag game to reorder" title="Drag to reorder" onPointerDown={onPointerDown}
          style={{ color: C.sub }} className="mt-0.5 touch-none select-none cursor-grab hover:text-ink active:cursor-grabbing transition-colors shrink-0"
          onClick={event => event.stopPropagation()}><I.grip /></button>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span style={{ background: C.violet, color: 'white' }} className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">Game</span>
            <span style={{ color: C.sub }} className="text-[10px]">
              Random chance · {showGame.rewardType === 'points' ? `${showGame.rewardPoints} bonus ${showGame.rewardPoints === 1 ? 'point' : 'points'}` : 'Custom prize'}
            </span>
          </div>
          <p style={{ color: C.ink }} className="truncate text-sm font-semibold group-hover:text-violet">💣 {showGame.title}</p>
        </div>
        <div onClick={event => event.stopPropagation()}><IBtn icon={<I.trash />} title="Delete game" onClick={onDelete} danger /></div>
      </div>
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.violet}30` }} className="space-y-3 px-4 pb-4 pt-3">
          <div>
            <label style={{ color: C.sub }} className="mb-1 block text-[10px] font-bold uppercase tracking-wider">Game</label>
            <div style={{ border: `1px solid ${C.line}`, background: C.panel, color: C.ink }} className="rounded-xl px-3 py-2 text-sm font-bold">Beat the Bomb</div>
          </div>
          <div>
            <label style={{ color: C.sub }} className="mb-1 block text-[10px] font-bold uppercase tracking-wider">Title</label>
            <input value={showGame.title} onChange={event => onChange({ title: event.target.value })}
              style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full rounded-xl bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
          </div>
          <div>
            <label style={{ color: C.sub }} className="mb-1 block text-[10px] font-bold uppercase tracking-wider">Reward</label>
            <div className="grid grid-cols-2 gap-2">
              {(['points', 'custom'] as const).map(type => (
                <button key={type} type="button" onClick={() => onChange({ rewardType: type })}
                  style={{ border: `1px solid ${showGame.rewardType === type ? C.violet : C.line}`, background: showGame.rewardType === type ? C.violetMist : 'white', color: showGame.rewardType === type ? C.violet : C.ink }}
                  className="cursor-pointer rounded-xl px-3 py-2 text-sm font-bold">
                  {type === 'points' ? 'Bonus points' : 'Custom prize'}
                </button>
              ))}
            </div>
          </div>
          {showGame.rewardType === 'points' && (
            <div>
              <label style={{ color: C.sub }} className="mb-1 block text-[10px] font-bold uppercase tracking-wider">Bonus points</label>
              <input type="number" min={1} max={100} value={showGame.rewardPoints}
                onChange={event => onChange({ rewardPoints: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })}
                style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-28 rounded-xl bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
            </div>
          )}
          <div>
            <label style={{ color: C.sub }} className="mb-1 block text-[10px] font-bold uppercase tracking-wider">What will the winner get?</label>
            <input value={showGame.rewardDescription} onChange={event => onChange({ rewardDescription: event.target.value })}
              placeholder={showGame.rewardType === 'points'
                ? showGameRewardDescription({ type: 'points', points: showGame.rewardPoints, description: '', winnerMessage: '' })
                : 'e.g. The winner of this game will win a free jug of beer'}
              style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full rounded-xl bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
            <p style={{ color: C.sub }} className="mt-1 text-[11px]">Shown to everyone before and during the game.</p>
          </div>
          {showGame.rewardType === 'custom' && (
            <div>
              <label style={{ color: C.sub }} className="mb-1 block text-[10px] font-bold uppercase tracking-wider">Winner message</label>
              <textarea rows={2} value={showGame.winnerMessage} onChange={event => onChange({ winnerMessage: event.target.value })}
                placeholder="e.g. You won! Head to the bar for your beer!"
                style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full resize-none rounded-xl bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
            </div>
          )}
          <p style={{ color: C.sub }} className="text-xs leading-5">Each team presses once. The fuse lasts a random 10–30 seconds, and the last team to press before it explodes wins.</p>
          <div className="flex justify-end"><button onClick={() => setExpanded(false)} style={{ color: C.violet }} className="text-xs font-semibold">Done</button></div>
        </div>
      )}
    </div>
  )
}

function BuilderQuestion({ q, idx, replacing, onEdit, onReplace, onCycleLibrary, onDelete, onDuplicate, onPointerDown }: {
  q: BuilderQuestionData
  idx: number
  replacing: boolean
  onEdit: () => void
  onReplace: () => void
  onCycleLibrary: () => void
  onDelete: () => void
  onDuplicate: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const isLibraryQuestion = q.sourceOrigin === 'platform'
  const hasCategory = Boolean(q.cat && q.cat !== 'Uncategorised')
  const hasDifficulty = Boolean(q.diff && q.diff !== 'Unrated')

  return (
    <div onClick={onEdit} style={{
      border: `1px solid ${isLibraryQuestion ? '#C4B5FD' : C.line}`,
      background: isLibraryQuestion ? '#F7F5FF' : 'white',
      boxShadow: isLibraryQuestion ? `inset 3px 0 0 ${C.violet}` : undefined,
      cursor: 'pointer',
      opacity: replacing ? 0.6 : 1,
    }}
      className="flex items-start gap-3 px-3 py-3 rounded-xl hover:border-violet hover:shadow-sm transition-all group">
      <button type="button" aria-label={`Drag question ${idx + 1} to reorder`} title="Drag to reorder"
        onPointerDown={onPointerDown}
        style={{ color: C.sub }} className="mt-0.5 touch-none select-none cursor-grab hover:text-ink active:cursor-grabbing transition-colors shrink-0"
        onClick={e => e.stopPropagation()}><I.grip /></button>
      <div className="flex-1 min-w-0">
        {isLibraryQuestion && (
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-violet-700">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-100">★</span>
            Question Library
          </div>
        )}
        {q.hasImage && (
          <div style={{ background: C.ground, border: `1px solid ${C.line}` }}
            className="rounded-lg h-16 mb-2 flex items-center justify-center gap-2 overflow-hidden">
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
              <rect x="1" y="1" width="16" height="12" rx="2" stroke={C.sub} strokeWidth="1.2"/>
              <circle cx="5.5" cy="5" r="1.5" fill={C.sub} fillOpacity="0.5"/>
              <path d="M1 10l4-4 3 3 2.5-2.5L16 12" stroke={C.sub} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ color: C.sub }} className="text-xs">{q.imageUrl?.split('/').pop() ?? 'Question image'}</span>
          </div>
        )}
        <div className="flex items-start gap-2 mb-2">
          <span style={{ color: C.sub }} className="text-[11px] font-mono shrink-0 mt-0.5">Q{idx + 1}</span>
          <p style={{ color: C.ink }} className="text-sm leading-snug group-hover:text-violet transition-colors">{q.text}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {hasCategory && <Chip>{q.cat}</Chip>}
          {hasDifficulty && <Chip color={difficultyChipColor(q.diff)}>{q.diff}</Chip>}
          <Chip color="violet">{q.type}</Chip>
          {q.hasImage && <Chip color="violet">📷 Image</Chip>}
          {q.bonus !== null && <Chip color="medium">+ Bonus</Chip>}
          <span style={{ color: C.violet }} className="text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 ml-1">
            <I.pencil /> Edit
          </span>
        </div>
        <BuilderQuestionAnswerPreview question={q} />
      </div>
      <div className="flex items-center gap-1 shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
        {isLibraryQuestion && (
          <button
            type="button"
            disabled={replacing}
            onClick={onCycleLibrary}
            title="Automatically find another similar unused library question"
            className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
          >
            <I.refresh /> {replacing ? 'Finding…' : 'Try another'}
          </button>
        )}
        <IBtn icon={<I.browse />} title={isLibraryQuestion ? 'Choose replacement manually' : 'Choose replacement'} onClick={onReplace} />
        <IBtn icon={<I.copy />} title="Duplicate" onClick={onDuplicate} />
        <IBtn icon={<I.trash />} title="Delete" onClick={onDelete} danger />
      </div>
    </div>
  )
}

// ─── SCREEN 4: QUESTION EDITOR ────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ color: C.sub }} className="block text-[11px] font-bold uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function OptionalField({ label, shown, onToggle, children }: {
  label: string; shown: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider">{label}</label>
        <button onClick={onToggle} style={{ color: shown ? C.sub : C.violet }}
          className="text-[11px] font-semibold hover:opacity-70 transition-opacity">
          {shown ? 'Remove' : '+ Add'}
        </button>
      </div>
      {children}
    </div>
  )
}

type QType = 'single' | 'multiple-choice' | 'multi-answer' | 'multi-part' | 'ranking'

function AlternatesField({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <div className="flex items-start justify-between mb-1.5">
        <div>
          <label style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider block">Accepted alternate answers</label>
          <p style={{ color: C.sub }} className="text-[11px] mt-0.5 opacity-70">Capitalisation and punctuation are ignored automatically.</p>
        </div>
        <button onClick={() => onChange([...values, ''])} style={{ color: C.violet }} className="text-[11px] font-semibold hover:opacity-70 shrink-0 mt-0.5">+ Add</button>
      </div>
      <div className="space-y-2">
        {values.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <div style={{ border: `1px solid ${C.line}`, background: C.ground }}
              className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
              <span style={{ color: C.go }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="5" fill="currentColor" fillOpacity="0.15"/>
                  <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <input value={a} onChange={e => onChange(values.map((v, j) => j === i ? e.target.value : v))}
                style={{ color: C.ink }} className="flex-1 bg-transparent focus:outline-none" />
            </div>
            <button onClick={() => onChange(values.filter((_, j) => j !== i))}
              style={{ color: C.sub }} className="p-1 hover:text-stop transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function acceptedAnswerGroups(value: unknown): string[][] {
  if (!Array.isArray(value)) return []
  return value.map(group => Array.isArray(group)
    ? group.map(item => String(item))
    : [String(group)])
}

function QuestionEditor({ question, title, onClose, onSave }: {
  question: BuilderQuestionData
  title?: string
  onClose: () => void
  onSave: (question: BuilderQuestionData) => void | Promise<void>
}) {
  const initialOptions = questionOptions(question.options)
  const initialAnswers = asStringArray(question.correctAnswer)
  const initialDifficulty = isTriviaDifficulty(question.diff)
    ? question.diff
    : null
  const [qtype, setQtype] = useState<QType>(() => editorQuestionType(question.questionType))
  const [pendingType, setPendingType] = useState<QType | null>(null)
  const [prompt, setPrompt] = useState(question.text)
  const [singleAnswer, setSingleAnswer] = useState(() => typeof question.correctAnswer === 'string' ? question.correctAnswer : '')
  const acceptedGroups = acceptedAnswerGroups(question.acceptedAnswers)
  const [choiceOptions, setChoiceOptions] = useState(() => {
    const loaded = initialOptions.map((option, index) => ({
      key: option.key ?? String.fromCharCode(65 + index),
      label: option.label ?? '',
    }))
    return loaded.length > 0 ? loaded : ['A', 'B', 'C', 'D'].map(key => ({ key, label: '' }))
  })
  const [correctChoice, setCorrectChoice] = useState(() => typeof question.correctAnswer === 'string' ? question.correctAnswer : 'A')
  const [rankingItems, setRankingItems] = useState(() => initialAnswers.length ? initialAnswers : (asStringArray(question.options).length ? asStringArray(question.options) : ['', '']))
  const [notes, setNotes] = useState(question.notes)
  const [imageUrl, setImageUrl] = useState(question.imageUrl ?? '')
  const [bonus, setBonus] = useState(() => sourceQuestionBonusDraft(question.bonus))
  const [showBonus, setShowBonus] = useState(() => question.bonus !== null)
  const [diff, setDiff] = useState<TriviaDifficulty | null>(initialDifficulty)
  const [cat, setCat] = useState(question.cat === 'Uncategorised' ? '' : question.cat)
  const [showCat, setShowCat] = useState(question.cat !== 'Uncategorised')
  const [showDiff, setShowDiff] = useState(initialDifficulty !== null)
  const [showTags, setShowTags] = useState(question.tags.length > 0)
  const [tags, setTags] = useState(question.tags)
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [tagOptions, setTagOptions] = useState<string[]>([])
  const [tagToAdd, setTagToAdd] = useState('')
  const [alternates, setAlternates] = useState<string[]>(() => acceptedGroups.flat().filter(Boolean))
  const [multiAnswers, setMultiAnswers] = useState(() => {
    const loaded = initialAnswers.map((text, index) => ({ text, alts: acceptedGroups[index] ?? [] }))
    return loaded.length > 0 ? loaded : [{ text: '', alts: [] as string[] }]
  })
  const [scoring, setScoring] = useState<'each' | 'all'>('each')
  const [parts, setParts] = useState(() => {
    const loaded = initialOptions.map((option, index) => ({
      label: option.label ?? String.fromCharCode(65 + index),
      text: option.clue ?? '',
      ans: initialAnswers[index] ?? '',
      alts: acceptedGroups[index] ?? [],
    }))
    return loaded.length > 0 ? loaded : [{ label: 'A', text: '', ans: '', alts: [] as string[] }]
  })
  const [savingQuestion, setSavingQuestion] = useState(false)
  const [questionSaveError, setQuestionSaveError] = useState<string | null>(null)

  const typeOrder: QType[] = ['single', 'multi-answer', 'multiple-choice', 'multi-part', 'ranking']
  const typeLabel: Record<QType, string> = {
    'single': 'Single Answer',
    'multi-answer': 'Multi-Answer',
    'multiple-choice': 'Multiple Choice',
    'multi-part': 'Multi-Part',
    'ranking': 'Ranking',
  }

  const hasDestructiveChange = (next: QType) =>
    (qtype === 'multiple-choice' || qtype === 'multi-answer' || qtype === 'multi-part' || qtype === 'ranking') && next === 'single'

  const handleTypeChange = (next: QType) => {
    if (hasDestructiveChange(next)) { setPendingType(next); return }
    setQtype(next)
  }

  const confirmTypeChange = () => { if (pendingType) { setQtype(pendingType); setPendingType(null) } }

  const blocked = !!pendingType

  useEffect(() => {
    let active = true
    void Promise.all([
      supabase.from('categories').select('name').eq('is_active', true).order('sort_order'),
      supabase.from('tags').select('name').eq('is_active', true).order('name'),
    ]).then(([categoryResult, tagResult]) => {
      if (!active) return
      if (categoryResult.error || tagResult.error) {
        console.error('Could not load controlled question metadata:', categoryResult.error ?? tagResult.error)
        return
      }
      setCategoryOptions((categoryResult.data ?? []).map(option => option.name))
      setTagOptions((tagResult.data ?? []).map(option => option.name))
    })
    return () => { active = false }
  }, [])

  async function handleSave() {
    const normalizedImageUrl = imageUrl.trim() || null
    const questionType: QuestionType = qtype === 'single'
      ? normalizedImageUrl ? 'image-question' : 'single-answer'
      : qtype

    let correctAnswer: unknown = singleAnswer.trim()
    let acceptedAnswers: unknown = alternates.map(value => value.trim()).filter(Boolean)
    let options: unknown = null
    let pointsMax = 1

    if (qtype === 'multiple-choice') {
      correctAnswer = correctChoice
      options = choiceOptions.map(option => ({ key: option.key, label: option.label.trim() }))
      acceptedAnswers = []
    } else if (qtype === 'multi-answer') {
      correctAnswer = multiAnswers.map(answer => answer.text.trim()).filter(Boolean)
      acceptedAnswers = multiAnswers.filter(answer => answer.text.trim()).map(answer => answer.alts.map(value => value.trim()).filter(Boolean))
      pointsMax = Math.max(1, asStringArray(correctAnswer).length)
    } else if (qtype === 'multi-part') {
      correctAnswer = parts.map(part => part.ans.trim())
      options = parts.map(part => ({ label: part.label, clue: part.text.trim() }))
      acceptedAnswers = parts.map(part => part.alts.map(value => value.trim()).filter(Boolean))
      pointsMax = Math.max(1, parts.length)
    } else if (qtype === 'ranking') {
      correctAnswer = rankingItems.map(item => item.trim()).filter(Boolean)
      options = correctAnswer
      acceptedAnswers = []
      pointsMax = Math.max(1, asStringArray(correctAnswer).length)
    }

    if ((qtype === 'single' && !String(correctAnswer).trim()) || (qtype !== 'single' && asStringArray(correctAnswer).length === 0 && qtype !== 'multiple-choice')) {
      setQuestionSaveError('Add the required correct answer content.')
      return
    }
    if (qtype === 'multiple-choice' && choiceOptions.some(option => !option.label.trim())) {
      setQuestionSaveError('Fill every multiple-choice option.')
      return
    }
    const bonusError = validateSourceQuestionBonus(bonus)
    if (bonusError) {
      setQuestionSaveError(bonusError)
      return
    }

    setSavingQuestion(true)
    setQuestionSaveError(null)
    try {
      await onSave({
        ...question,
        text: prompt.trim(),
        cat: showCat && cat.trim() ? cat.trim() : 'Uncategorised',
        diff: showDiff && diff ? diff : 'Unrated',
        type: questionTypeLabel(questionType),
        questionType,
        hasImage: Boolean(normalizedImageUrl),
        correctAnswer,
        acceptedAnswers,
        options,
        tags: showTags ? tags : [],
        imageUrl: normalizedImageUrl,
        pointsMax,
        bonus: sourceQuestionBonusPayload(bonus),
        notes: notes.trim(),
      })
    } catch (error) {
      console.error('Could not save question:', error)
      setQuestionSaveError('Could not save this question. Try again.')
    } finally {
      setSavingQuestion(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div style={{ background: 'rgba(12,11,24,0.4)' }} className="absolute inset-0 backdrop-blur-[2px]" onClick={onClose} />
      <div style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }}
        className="relative w-[500px] flex flex-col shadow-2xl">

        {/* Header */}
        <div style={{ borderBottom: `1px solid ${C.line}` }} className="flex items-center px-6 py-4 shrink-0">
          <h2 style={{ color: C.ink }} className="font-extrabold flex-1">{title ?? 'Edit Question'}</h2>
          <button onClick={onClose} style={{ color: C.sub }} className="hover:text-ink transition-colors p-1">{I.x()}</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Type dropdown */}
          <div className="px-6 pt-5 pb-4">
            <Field label="Question Type">
              <select
                value={qtype}
                onChange={e => handleTypeChange(e.target.value as QType)}
                style={{ border: `1px solid ${C.line}`, color: C.ink }}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30">
                {typeOrder.map(t => (
                  <option key={t} value={t}>{typeLabel[t]}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Destructive-change guard — dims everything below */}
          {blocked && (
            <div className="px-6 pb-4">
              <div style={{ background: '#FFF7ED', border: `1.5px solid #FED7AA` }} className="rounded-xl p-4">
                <p style={{ color: '#92400E' }} className="text-sm font-semibold mb-1">Switch to {typeLabel[pendingType!]}?</p>
                <p style={{ color: '#B45309' }} className="text-xs mb-3">The existing answer options will be removed. This can’t be undone.</p>
                <div className="flex gap-2">
                  <button onClick={confirmTypeChange}
                    style={{ background: C.caution, color: 'white' }}
                    className="px-4 py-2 rounded-lg text-xs font-bold">Yes, switch type</button>
                  <button onClick={() => setPendingType(null)}
                    style={{ border: `1px solid ${C.line}`, color: C.sub }}
                    className="px-4 py-2 rounded-lg text-xs font-semibold">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Rest of form — greyed out while guard is active */}
          <div className={`px-6 pb-5 space-y-5 transition-opacity ${blocked ? 'opacity-30 pointer-events-none select-none' : ''}`}>

            <Field label="Question">
              <textarea
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                rows={3}
                style={{ border: `1px solid ${C.line}`, color: C.ink }}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 resize-none leading-relaxed"
              />
            </Field>

            {/* ── Single Answer ── */}
            {qtype === 'single' && (
              <>
                <Field label="Correct Answer">
                  <input value={singleAnswer} onChange={event => setSingleAnswer(event.target.value)}
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30" />
                </Field>
                <AlternatesField values={alternates} onChange={setAlternates} />
              </>
            )}

            {/* ── Multiple Choice ── */}
            {qtype === 'multiple-choice' && (
              <Field label="Answer Options">
                <div className="space-y-2">
                  {choiceOptions.map((option, index) => {
                    const correct = option.key === correctChoice
                    return (
                    <div key={option.key}
                      style={{ border: `1.5px solid ${correct ? C.go : C.line}`, background: correct ? '#f0fdf9' : C.ground }}
                      className="flex items-center gap-3 p-3 rounded-xl">
                      <button type="button" onClick={() => setCorrectChoice(option.key)} style={{ background: correct ? C.go : C.line }}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">
                        {option.key}
                      </button>
                      <input value={option.label} onChange={event => setChoiceOptions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} style={{ color: C.ink }} className="flex-1 bg-transparent text-sm focus:outline-none" />
                      {correct && <span style={{ color: C.go }} className="text-xs font-bold shrink-0">✓ Correct</span>}
                    </div>
                  )})}
                  <button onClick={() => setChoiceOptions(current => [...current, { key: String.fromCharCode(65 + current.length), label: '' }])} style={{ color: C.violet }} className="text-xs font-semibold hover:underline flex items-center gap-1">
                    <I.plus /> Add option
                  </button>
                </div>
              </Field>
            )}

            {/* ── Multi-Answer ── */}
            {qtype === 'multi-answer' && (
              <>
                <Field label="Correct Answers">
                  <div className="space-y-3">
                    {multiAnswers.map((a, i) => (
                      <div key={i} style={{ border: `1px solid ${C.line}`, background: C.ground }} className="rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span style={{ color: C.go }} className="text-xs font-bold shrink-0">#{i + 1}</span>
                          <input value={a.text}
                            onChange={e => setMultiAnswers(ms => ms.map((m, j) => j === i ? { ...m, text: e.target.value } : m))}
                            style={{ color: C.ink, border: `1.5px solid ${C.go}`, background: '#f0fdf9' }}
                            className="flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-go/20" />
                          <button onClick={() => setMultiAnswers(ms => ms.filter((_, j) => j !== i))}
                            style={{ color: C.sub }} className="p-1 hover:text-stop transition-colors shrink-0">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                          </button>
                        </div>
                        {a.alts.map((alt, ai) => (
                          <div key={ai} className="flex items-center gap-1.5 pl-6">
                            <span style={{ color: C.sub }} className="text-[10px] shrink-0">also:</span>
                            <input value={alt}
                              onChange={e => setMultiAnswers(ms => ms.map((m, j) => j === i ? { ...m, alts: m.alts.map((v, k) => k === ai ? e.target.value : v) } : m))}
                              style={{ color: C.ink, border: `1px solid ${C.line}` }}
                              className="flex-1 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none" />
                            <button onClick={() => setMultiAnswers(ms => ms.map((m, j) => j === i ? { ...m, alts: m.alts.filter((_, k) => k !== ai) } : m))}
                              style={{ color: C.sub }} className="hover:text-stop transition-colors">
                              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                        ))}
                        <button onClick={() => setMultiAnswers(ms => ms.map((m, j) => j === i ? { ...m, alts: [...m.alts, ''] } : m))}
                          style={{ color: C.violet }} className="text-[11px] font-semibold hover:opacity-70 pl-6 flex items-center gap-1">
                          <I.plus /> Add alternate answer
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setMultiAnswers(ms => [...ms, { text: '', alts: [] }])}
                      style={{ color: C.violet }} className="text-xs font-semibold hover:underline flex items-center gap-1">
                      <I.plus /> Add correct answer
                    </button>
                  </div>
                </Field>
                <Field label="Scoring">
                  <div className="flex gap-2">
                    {[['each', 'One point each'] as const, ['all', 'All or nothing'] as const].map(([v, l]) => (
                      <button key={v} onClick={() => setScoring(v)}
                        style={{ border: `1.5px solid ${scoring === v ? C.violet : C.line}`, background: scoring === v ? C.violetMist : 'white', color: scoring === v ? C.violet : C.sub }}
                        className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all">{l}
                      </button>
                    ))}
                  </div>
                </Field>
              </>
            )}

            {/* ── Multi-Part ── */}
            {qtype === 'multi-part' && (
              <>
                <div>
                  <label style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider block mb-2">Parts</label>
                  <p style={{ color: C.sub }} className="text-[11px] mb-3 opacity-70">Each part has its own answer. Teams get one point per correct part.</p>
                  <div className="space-y-3">
                    {parts.map((part, pi) => (
                      <div key={pi} style={{ border: `1px solid ${C.line}`, background: C.ground }} className="rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span style={{ background: C.violetPale, color: C.violet }}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0">{part.label}</span>
                          <input value={part.text}
                            onChange={e => setParts(ps => ps.map((p, i) => i === pi ? { ...p, text: e.target.value } : p))}
                            style={{ color: C.ink, border: `1px solid ${C.line}` }}
                            className="flex-1 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30"
                            placeholder="Part description…" />
                          <button onClick={() => setParts(ps => ps.filter((_, i) => i !== pi))}
                            style={{ color: C.sub }} className="p-1 hover:text-stop transition-colors shrink-0">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                          </button>
                        </div>
                        <div className="flex items-center gap-2 pl-8">
                          <span style={{ color: C.go }} className="text-[11px] font-bold shrink-0">Answer:</span>
                          <input value={part.ans}
                            onChange={e => setParts(ps => ps.map((p, i) => i === pi ? { ...p, ans: e.target.value } : p))}
                            style={{ color: C.ink, border: `1px solid ${C.go}40`, background: '#f0fdf9' }}
                            className="flex-1 rounded-lg px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-go/20"
                            placeholder="Correct answer…" />
                        </div>
                        {part.alts.length > 0 && (
                          <div className="pl-8 space-y-1">
                            {part.alts.map((alt, ai) => (
                              <div key={ai} className="flex items-center gap-1.5">
                                <span style={{ color: C.sub }} className="text-[10px]">also:</span>
                                <input value={alt}
                                  onChange={e => setParts(ps => ps.map((p, i) => i === pi ? { ...p, alts: p.alts.map((a, j) => j === ai ? e.target.value : a) } : p))}
                                  style={{ color: C.ink, border: `1px solid ${C.line}` }}
                                  className="flex-1 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none" />
                                <button onClick={() => setParts(ps => ps.map((p, i) => i === pi ? { ...p, alts: p.alts.filter((_, j) => j !== ai) } : p))}
                                  style={{ color: C.sub }} className="hover:text-stop transition-colors">
                                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button onClick={() => setParts(ps => ps.map((p, i) => i === pi ? { ...p, alts: [...p.alts, ''] } : p))}
                          style={{ color: C.violet }} className="text-[11px] font-semibold hover:opacity-70 pl-8 flex items-center gap-1">
                          <I.plus /> Add alternate answer
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setParts(ps => [...ps, { label: String.fromCharCode(65 + ps.length), text: '', ans: '', alts: [] }])}
                      style={{ color: C.violet }} className="text-xs font-semibold hover:underline flex items-center gap-1">
                      <I.plus /> Add part
                    </button>
                  </div>
                </div>
                <Field label="Scoring">
                  <div className="flex gap-2">
                    {[['each', 'One point each'] as const, ['all', 'All or nothing'] as const].map(([v, l]) => (
                      <button key={v} onClick={() => setScoring(v)}
                        style={{ border: `1.5px solid ${scoring === v ? C.violet : C.line}`, background: scoring === v ? C.violetMist : 'white', color: scoring === v ? C.violet : C.sub }}
                        className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all">{l}
                      </button>
                    ))}
                  </div>
                </Field>
              </>
            )}

            {/* ── Ranking ── */}
            {qtype === 'ranking' && (
              <>
                <Field label="Correct Order (drag to reorder)">
                  <div className="space-y-2">
                    {rankingItems.map((item, i) => (
                      <div key={i} style={{ border: `1px solid ${C.line}`, background: C.ground }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                        <span style={{ color: C.sub }} className="cursor-grab"><I.grip /></span>
                        <span style={{ background: C.violetPale, color: C.violet }}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0">{i + 1}</span>
                        <input value={item} onChange={event => setRankingItems(current => current.map((value, index) => index === i ? event.target.value : value))} style={{ color: C.ink }} className="flex-1 bg-transparent text-sm focus:outline-none" />
                      </div>
                    ))}
                    <button onClick={() => setRankingItems(current => [...current, ''])} style={{ color: C.violet }} className="text-xs font-semibold hover:underline flex items-center gap-1">
                      <I.plus /> Add item
                    </button>
                  </div>
                </Field>
                <Field label="Scoring">
                  <div className="flex gap-2">
                    {[['each', 'One point per correct place'] as const, ['all', 'All in order only'] as const].map(([v, l]) => (
                      <button key={v} onClick={() => setScoring(v)}
                        style={{ border: `1.5px solid ${scoring === v ? C.violet : C.line}`, background: scoring === v ? C.violetMist : 'white', color: scoring === v ? C.violet : C.sub }}
                        className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all">{l}
                      </button>
                    ))}
                  </div>
                  <p style={{ color: C.sub }} className="text-[11px] mt-2">
                    {scoring === 'each' ? 'Teams earn one point for each item placed in the correct position.' : 'Teams must place every item correctly to score any points.'}
                  </p>
                </Field>
              </>
            )}

            <OptionalField label="Bonus Question (Optional)" shown={showBonus} onToggle={() => {
              if (!showBonus && !bonus.enabled) setBonus({ ...EMPTY_SOURCE_QUESTION_BONUS, enabled: true })
              setShowBonus(value => !value)
            }}>
              {showBonus && (
                <div style={{ border: `1px solid ${C.violetPale}`, background: C.violetMist }} className="space-y-3 rounded-xl p-4">
                  <p style={{ color: C.sub }} className="text-[11px] leading-5">One optional typed-answer bonus. It adds points and running time, but not another normal question.</p>
                  <textarea value={bonus.prompt} onChange={event => setBonus({ ...bonus, prompt: event.target.value })} rows={2} placeholder="Bonus question"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
                  <div className="grid grid-cols-[1fr_7rem] gap-3">
                    <input value={bonus.answer} onChange={event => setBonus({ ...bonus, answer: event.target.value })} placeholder="Correct bonus answer"
                      style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
                    <input type="number" min={1} step={1} value={bonus.points} onChange={event => setBonus({ ...bonus, points: Number(event.target.value) })} aria-label="Bonus points"
                      style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
                  </div>
                  <input value={bonus.aliases} onChange={event => setBonus({ ...bonus, aliases: event.target.value })} placeholder="Accepted alternatives, separated by commas"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
                  <input value={bonus.imageUrl} onChange={event => setBonus({ ...bonus, imageUrl: event.target.value })} placeholder="Bonus image URL (optional)"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }} className="w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30" />
                  <button type="button" onClick={() => { setBonus({ ...EMPTY_SOURCE_QUESTION_BONUS }); setShowBonus(false) }} style={{ color: C.stop }} className="text-xs font-bold hover:underline">Remove bonus</button>
                </div>
              )}
            </OptionalField>

            <OptionalField label="Category (Optional)" shown={showCat} onToggle={() => { setShowCat(v => !v); setCat('') }}>
              {showCat && (
                <select value={cat} onChange={e => setCat(e.target.value)}
                  style={{ border: `1px solid ${C.line}`, color: C.ink }}
                  className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30">
                  <option value="">Choose a category…</option>
                  {cat && !categoryOptions.includes(cat) ? <option value={cat}>{cat} (legacy)</option> : null}
                  {categoryOptions.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              )}
            </OptionalField>

            <OptionalField label="Difficulty (Optional)" shown={showDiff} onToggle={() => { setShowDiff(v => !v); setDiff(null) }}>
              {showDiff && (
                <div className="flex flex-wrap gap-2">
                  {TRIVIA_DIFFICULTIES.map(d => {
                    const toneStyle = difficultyToneStyle(d)
                    return (
                      <button key={d} onClick={() => setDiff(d)}
                        style={{
                          border: `1.5px solid ${diff === d ? toneStyle.border : C.line}`,
                          background: diff === d ? toneStyle.background : 'white',
                          color: diff === d ? toneStyle.text : C.sub,
                        }}
                        className="flex-1 min-w-[82px] py-2.5 rounded-xl text-xs font-semibold transition-all">{d}
                      </button>
                    )
                  })}
                </div>
              )}
            </OptionalField>

            <OptionalField label="Tags (Optional)" shown={showTags} onToggle={() => setShowTags(v => !v)}>
              {showTags && (
                <>
                  <select value={tagToAdd} onChange={event => {
                    const nextTag = event.target.value
                    setTagToAdd('')
                    if (nextTag) setTags(current => current.includes(nextTag) ? current : [...current, nextTag])
                  }}
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30">
                    <option value="">Add a controlled tag…</option>
                    {tagOptions.filter(option => !tags.includes(option)).map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                  {tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tags.map(tag => (
                        <button key={tag} type="button" onClick={() => setTags(current => current.filter(value => value !== tag))}
                          style={{ background: C.violetMist, color: C.violet }} className="rounded-full px-2.5 py-1 text-[11px] font-semibold">
                          {tag} ×
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <p style={{ color: C.sub }} className="text-[11px] mt-1.5 opacity-70">Tags are more specific than category and help filtering and auto-build variety.</p>
                </>
              )}
            </OptionalField>

            <Field label="Host Notes">
              <textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Optional facts, clarifications, or notes to read while announcing the answer."
                style={{ border: `1px solid ${C.line}`, color: C.ink }}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 resize-none placeholder:text-sub" />
            </Field>

            <Field label="Image (Optional)">
              <input value={imageUrl} onChange={event => setImageUrl(event.target.value)} placeholder="https://example.com/question-image.png"
                style={{ border: `1px solid ${C.line}`, color: C.ink }}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30" />
              <p style={{ color: C.sub }} className="text-[11px] mt-1.5 opacity-70">Image uploads will be added later; existing hosted image URLs are preserved here.</p>
            </Field>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${C.line}` }} className="flex justify-end gap-2 px-6 py-4 shrink-0">
          {questionSaveError && <span style={{ color: C.stop }} className="mr-auto self-center text-xs font-semibold">{questionSaveError}</span>}
          <Btn v="secondary" sz="sm" onClick={onClose}>Cancel</Btn>
          <Btn sz="sm" onClick={() => void handleSave()} disabled={blocked || !prompt.trim() || savingQuestion}>{savingQuestion ? 'Saving…' : 'Save Question'}</Btn>
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 5: AUTO-BUILD ─────────────────────────────────────────────────────

function AutoBuild({ go }: { go: Go }) {
  const [mode, setMode] = useState<'mixed' | 'custom'>('mixed')
  const [diff, setDiff] = useState<[number, number]>([0, 4])
  const [questionCount, setQuestionCount] = useState(30)
  const [questionCountInput, setQuestionCountInput] = useState('30')
  const [roundCount, setRoundCount] = useState(4)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [audienceFit, setAudienceFit] = useState<AutoBuildAudiencePreference>('all')
  const [allowAdultContent, setAllowAdultContent] = useState(false)
  const [scopeMode, setScopeMode] = useState<AutoBuildScopeMode>('global_only')
  const [audienceLocale, setAudienceLocale] = useState('')

  const startDifficultyDrag = (handle: 'minimum' | 'maximum', event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const track = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!track) return
    const pointerId = event.pointerId

    const updateFromPointer = (clientX: number) => {
      const ratio = Math.max(0, Math.min(1, (clientX - track.left) / track.width))
      const value = Math.round(ratio * (diffLabels.length - 1))
      setDiff(current => handle === 'minimum'
        ? [Math.min(value, current[1]), current[1]]
        : [current[0], Math.max(value, current[0])])
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) updateFromPointer(moveEvent.clientX)
    }
    const stop = (stopEvent: PointerEvent) => {
      if (stopEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }

    updateFromPointer(event.clientX)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  const [topics, setTopics] = useState(['General Knowledge', 'Film & Television', 'Sport', 'Music'])
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [sourceQuestions, setSourceQuestions] = useState<AutoBuildSourceQuestion[]>([])
  const [sourceTiebreakers, setSourceTiebreakers] = useState<AutoBuildSourceTiebreaker[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const diffLabels = TRIVIA_DIFFICULTIES
  const allTopics = ['General Knowledge', ...SOURCE_QUESTION_CATEGORIES]
  const selectedDifficulties = useMemo(() => TRIVIA_DIFFICULTIES.slice(diff[0], diff[1] + 1), [diff])
  const selectedRoundTopics = useMemo(
    () => mode === 'mixed' ? Array.from({ length: roundCount }, () => null) : topics,
    [mode, roundCount, topics],
  )
  const contentSettings = useMemo(() => ({
    audienceFit,
    allowAdultContent,
    scopeMode,
    locale: audienceLocale.trim(),
  }), [allowAdultContent, audienceFit, audienceLocale, scopeMode])
  const availability = useMemo(() => getAutoBuildAvailability({
    questions: sourceQuestions,
    questionCount,
    roundTopics: selectedRoundTopics,
    difficulties: selectedDifficulties,
    contentSettings,
  }), [contentSettings, questionCount, selectedDifficulties, selectedRoundTopics, sourceQuestions])
  const eligibleTiebreakerCount = useMemo(
    () => getEligibleAutoBuildTiebreakers(sourceTiebreakers, contentSettings).length,
    [contentSettings, sourceTiebreakers],
  )
  const firstShortage = availability.shortages[0]
  const countsAreValid = questionCount >= roundCount
  const localeIsValid = scopeMode === 'global_only' || audienceLocale.trim().length > 0
  const canGenerate = countsAreValid
    && localeIsValid
    && !sourcesLoading
    && !sourcesError
    && availability.canBuild
    && eligibleTiebreakerCount >= AUTO_BUILD_TIEBREAKER_COUNT

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      loadAllSourceRows<AutoBuildSourceQuestion>(async (from, to) => {
        const { data, error } = await supabase
          .from('source_question_catalog')
          .select('*')
          .eq('origin', 'platform')
          .eq('status', 'active')
          .eq('is_verified', true)
          .order('id', { ascending: true })
          .range(from, to)
        return { data, error }
      }),
      supabase
        .from('source_tiebreakers')
        .select('*')
        .eq('status', 'active')
        .eq('is_verified', true)
        .range(0, 99),
    ]).then(([questionResult, tiebreakerResult]) => {
      if (cancelled) return
      if (questionResult.error || tiebreakerResult.error) {
        console.error('Could not load Auto-Build sources:', questionResult.error ?? tiebreakerResult.error)
        setSourcesError('Could not check the Question Library. Refresh the page to try again.')
      } else {
        setSourceQuestions(questionResult.data ?? [])
        setSourceTiebreakers(tiebreakerResult.data ?? [])
      }
    }).catch(error => {
      if (cancelled) return
      console.error('Could not load Auto-Build sources:', error)
      setSourcesError('Could not check the Question Library. Refresh the page to try again.')
    }).finally(() => {
      if (!cancelled) setSourcesLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const diffText = () => {
    const [lo, hi] = diff
    return lo === hi ? `${diffLabels[lo]} only` : `${diffLabels[lo]} through ${diffLabels[hi]}`
  }
  const availabilityHasError = !countsAreValid
    || !localeIsValid
    || !!sourcesError
    || (!sourcesLoading && (!!firstShortage || eligibleTiebreakerCount < AUTO_BUILD_TIEBREAKER_COUNT))
  const availabilityMessage = !countsAreValid
    ? 'The question count must be at least the number of rounds.'
    : !localeIsValid
      ? 'Enter a country or locale to include country-specific questions.'
      : sourcesLoading
        ? 'Checking Question Library availability…'
        : sourcesError
          ? sourcesError
          : audienceFit === 'guys_wearing_hats'
            ? 'No questions found matching these settings.'
          : firstShortage
            ? `Not enough ${firstShortage.topic ?? 'matching'} questions: ${firstShortage.available} available, ${firstShortage.required} needed.`
            : eligibleTiebreakerCount < AUTO_BUILD_TIEBREAKER_COUNT
              ? `Only ${eligibleTiebreakerCount} prepared tiebreaker${eligibleTiebreakerCount === 1 ? '' : 's'} match these settings; ${AUTO_BUILD_TIEBREAKER_COUNT} are needed.`
              : `${availability.matchingQuestionCount} matching questions available for this setup.`

  function updateRoundCount(nextCount: number) {
    const safeCount = Math.max(1, Math.min(10, nextCount))
    setRoundCount(safeCount)
    setTopics(current => Array.from({ length: safeCount }, (_, index) => current[index] ?? 'General Knowledge'))
  }

  function updateQuestionCount(nextCount: number) {
    const safeCount = Math.max(1, Math.min(100, nextCount))
    setQuestionCount(safeCount)
    setQuestionCountInput(String(safeCount))
  }

  async function generateQuiz() {
    if (generating || !canGenerate) return
    setGenerating(true)
    setGenerateError(null)

    try {
      const plan = buildAutoQuizPlan({
        questions: sourceQuestions,
        tiebreakers: sourceTiebreakers,
        questionCount,
        roundTopics: selectedRoundTopics,
        difficulties: selectedDifficulties,
        contentSettings,
      })
      const questionSnapshots: Json[] = []
      let position = 0

      plan.rounds.forEach((round, roundIndex) => {
        round.questions.forEach((question, roundIndexPosition) => {
          position += 1
          questionSnapshots.push({
            question_key: `question-${crypto.randomUUID()}`,
            position,
            item_position: position,
            round_number: roundIndex + 1,
            round_position: roundIndexPosition + 1,
            round_question_count: round.questions.length,
            round_title: round.title,
            prompt: question.prompt,
            category: question.category,
            difficulty: question.difficulty,
            question_type: question.question_type,
            correct_answer: question.correct_answer,
            accepted_answers: question.accepted_answers,
            options: question.options,
            tags: question.tags,
            image_url: question.image_url,
            points_max: Array.isArray(question.correct_answer) ? Math.max(1, question.correct_answer.length) : 1,
            bonus: question.bonus,
            notes: question.notes,
            source_question_id: question.id,
            source_revision: question.revision,
          })
        })
      })

      const tiebreakerSnapshots: Json[] = plan.tiebreakers.map((tiebreaker, index) => ({
        tiebreaker_key: `tiebreaker-${crypto.randomUUID()}`,
        position: index + 1,
        prompt: tiebreaker.prompt,
        correct_value: String(tiebreaker.correct_value),
        answer_unit: tiebreaker.answer_unit,
        notes: tiebreaker.notes,
      }))
      const title = 'Auto-Built Quiz'
      const { data, error } = await supabase.rpc('save_quiz_with_show_games', {
        p_quiz_id: null,
        p_title: title,
        p_status: 'draft',
        p_estimated_minutes: estimatedQuizMinutes(questionCount, plan.rounds.reduce((total, round) => total + round.questions.filter(question => question.bonus !== null).length, 0)),
        p_questions: questionSnapshots,
        p_content_screens: [],
        p_tiebreakers: tiebreakerSnapshots,
        p_show_games: [],
      })

      if (error || !data) throw error ?? new Error('No quiz id returned')
      localStorage.setItem('simple-trivia-selected-quiz-id', data)
      localStorage.setItem('simple-trivia-selected-quiz-title', title)
      go('quiz-builder')
    } catch (error) {
      console.error('Could not generate quiz:', error)
      setGenerateError(error instanceof Error ? error.message : 'Could not generate this quiz. Try again.')
      setGenerating(false)
    }
  }

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <Nav go={go} />
      <main className="max-w-2xl mx-auto px-6 py-12">
        <button onClick={() => go('create-quiz')} style={{ color: C.sub }}
          className="flex items-center gap-1.5 text-sm hover:text-violet transition-colors mb-8">
          <I.back /> Back
        </button>
        <h1 style={{ color: C.ink }} className="text-3xl font-extrabold mb-8">Build My Quiz</h1>

        <div className="space-y-4">
          {/* Quiz size */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5">
            <label style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider block mb-4">Quiz Size</label>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label style={{ color: C.ink }} className="block text-sm font-bold mb-2">Questions</label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => updateQuestionCount(questionCount - 1)} aria-label="Remove one question"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }} className="h-9 w-9 rounded-xl text-lg font-bold hover:bg-ground">−</button>
                  <input type="number" min={1} max={100} value={questionCountInput}
                    onChange={event => {
                      setQuestionCountInput(event.target.value)
                      const parsed = Number(event.target.value)
                      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) setQuestionCount(parsed)
                    }}
                    onBlur={() => updateQuestionCount(questionCount)}
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                    className="h-9 w-20 rounded-xl bg-white text-center text-lg font-extrabold tabular-nums focus:outline-none focus:ring-2 focus:ring-violet/30" />
                  <button type="button" onClick={() => updateQuestionCount(questionCount + 1)} aria-label="Add one question"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }} className="h-9 w-9 rounded-xl text-lg font-bold hover:bg-ground">+</button>
                </div>
              </div>
              <div>
                <label style={{ color: C.ink }} className="block text-sm font-bold mb-2">Rounds</label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => updateRoundCount(roundCount - 1)} aria-label="Remove one round"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }} className="h-9 w-9 rounded-xl text-lg font-bold hover:bg-ground">−</button>
                  <span style={{ border: `1px solid ${C.line}`, color: C.ink }} className="flex h-9 w-20 items-center justify-center rounded-xl bg-white text-lg font-extrabold tabular-nums">{roundCount}</span>
                  <button type="button" onClick={() => updateRoundCount(roundCount + 1)} aria-label="Add one round"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }} className="h-9 w-9 rounded-xl text-lg font-bold hover:bg-ground">+</button>
                </div>
              </div>
            </div>
            <p style={{ color: countsAreValid ? C.sub : C.stop }} className="mt-4 text-xs">
              {countsAreValid
                ? autoBuildSizeSummary(questionCount, roundCount)
                : 'Add at least one question for every round.'}
            </p>
          </div>

          {/* Topics */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5">
            <label style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider block mb-3">Round Categories</label>
            <div className="flex gap-2 mb-4">
              {([['mixed', 'Mixed Topics'], ['custom', 'Choose by Round']] as ['mixed' | 'custom', string][]).map(([v, l]) => (
                <button key={v} onClick={() => setMode(v)}
                  style={{
                    border: `1.5px solid ${mode === v ? C.violet : C.line}`,
                    background: mode === v ? C.violet : 'white',
                    color: mode === v ? 'white' : C.sub,
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all">
                  {l}
                </button>
              ))}
            </div>
            {mode === 'custom' && (
              <div className="space-y-2">
                {topics.map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span style={{ color: C.sub }} className="text-xs font-mono w-14 shrink-0">Round {i + 1}</span>
                    <select value={t} onChange={event => setTopics(current => current.map((topic, topicIndex) => topicIndex === i ? event.target.value : topic))} style={{ border: `1px solid ${C.line}`, color: C.ink }}
                      className="flex-1 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30">
                      {allTopics.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advanced content settings */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="overflow-hidden rounded-2xl">
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen(open => !open)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-ground"
            >
              <p style={{ color: C.ink }} className="min-w-0 flex-1 text-sm font-bold">Advanced Settings</p>
              <span style={{ color: C.sub }} className={`text-sm transition-transform ${advancedOpen ? 'rotate-180' : ''}`}>⌄</span>
            </button>

            {advancedOpen && (
              <div style={{ borderTop: `1px solid ${C.line}` }} className="space-y-6 px-5 py-5">
                <div>
                  <label style={{ color: C.ink }} className="block text-sm font-bold">Difficulty range</label>
                  <p style={{ color: C.sub }} className="mt-1 text-xs leading-5">Choose the easiest and hardest questions Auto-Build may use.</p>
                  <div className="relative mb-5 mt-5" style={{ paddingBottom: 4 }}>
                    <div style={{ background: C.line, height: 6 }} className="relative w-full rounded-full">
                      <div style={{
                        position: 'absolute',
                        left: `${(diff[0] / (diffLabels.length - 1)) * 100}%`,
                        right: `${(((diffLabels.length - 1) - diff[1]) / (diffLabels.length - 1)) * 100}%`,
                        height: '100%',
                        background: C.violet,
                        borderRadius: 4,
                      }} />
                    </div>
                    <button type="button" role="slider"
                      aria-label="Minimum difficulty"
                      aria-valuemin={0} aria-valuemax={diffLabels.length - 1} aria-valuenow={diff[0]} aria-valuetext={diffLabels[diff[0]]}
                      onPointerDown={e => startDifficultyDrag('minimum', e)}
                      onKeyDown={e => {
                        if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
                        e.preventDefault()
                        const value = e.key === 'Home' ? 0 : e.key === 'End' ? diff[1] : diff[0] + (['ArrowRight', 'ArrowUp'].includes(e.key) ? 1 : -1)
                        setDiff(current => [Math.max(0, Math.min(value, current[1])), current[1]])
                      }}
                      className="dual-range-thumb absolute p-0"
                      style={{ left: `calc(${(diff[0] / (diffLabels.length - 1)) * 100}% - 10px)`, top: -7, zIndex: diff[0] === diff[1] ? 3 : 2 }} />
                    <button type="button" role="slider"
                      aria-label="Maximum difficulty"
                      aria-valuemin={0} aria-valuemax={diffLabels.length - 1} aria-valuenow={diff[1]} aria-valuetext={diffLabels[diff[1]]}
                      onPointerDown={e => startDifficultyDrag('maximum', e)}
                      onKeyDown={e => {
                        if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
                        e.preventDefault()
                        const value = e.key === 'Home' ? diff[0] : e.key === 'End' ? diffLabels.length - 1 : diff[1] + (['ArrowRight', 'ArrowUp'].includes(e.key) ? 1 : -1)
                        setDiff(current => [current[0], Math.min(diffLabels.length - 1, Math.max(value, current[0]))])
                      }}
                      className="dual-range-thumb absolute p-0"
                      style={{ left: `calc(${(diff[1] / (diffLabels.length - 1)) * 100}% - 10px)`, top: -7, zIndex: 2 }} />
                  </div>
                  <div className="mb-3 flex justify-between">
                    {diffLabels.map((label, index) => {
                      const toneStyle = difficultyToneStyle(label)
                      const isInRange = index >= diff[0] && index <= diff[1]
                      return (
                        <span key={label} style={{
                          color: toneStyle.text,
                          fontWeight: (index === diff[0] || index === diff[1]) ? 700 : 500,
                          opacity: isInRange ? 1 : 0.38,
                        }} className="flex-1 text-center text-[11px]">{label}</span>
                      )
                    })}
                  </div>
                  <p style={{ color: C.sub }} className="text-sm">
                    Sourcing: <span style={{ color: C.ink }} className="font-semibold">{diffText()}</span>
                  </p>
                </div>

                <div>
                  <label htmlFor="auto-build-audience-fit" style={{ color: C.ink }} className="block text-sm font-bold">Audience fit</label>
                  <p style={{ color: C.sub }} className="mt-1 text-xs leading-5">Use every audience fit, or prioritise one. Broad questions can still be used when they are the best fit.</p>
                  <select
                    id="auto-build-audience-fit"
                    value={audienceFit}
                    onChange={event => setAudienceFit(event.target.value as AutoBuildAudiencePreference)}
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                    className="mt-3 w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30"
                  >
                    <option value="all">All audience fits</option>
                    <option value="broad">Broad audience</option>
                    <option value="kids">Kids</option>
                    <option value="young_adults">Young adults</option>
                    <option value="older_adults">Older adults</option>
                    <option value="guys_wearing_hats">Guys wearing hats</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="auto-build-scope" style={{ color: C.ink }} className="block text-sm font-bold">Geographic scope</label>
                  <p style={{ color: C.sub }} className="mt-1 text-xs leading-5">Keep the quiz globally suitable, or also allow questions intended for one country or locale.</p>
                  <select
                    id="auto-build-scope"
                    value={scopeMode}
                    onChange={event => setScopeMode(event.target.value as AutoBuildScopeMode)}
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                    className="mt-3 w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30"
                  >
                    <option value="global_only">Global questions only</option>
                    <option value="include_locale">Global + one country or locale</option>
                  </select>
                  {scopeMode === 'include_locale' && (
                    <div className="mt-3">
                      <label htmlFor="auto-build-locale" style={{ color: C.sub }} className="block text-xs font-bold">Country or locale</label>
                      <input
                        id="auto-build-locale"
                        value={audienceLocale}
                        onChange={event => setAudienceLocale(event.target.value)}
                        placeholder="e.g. Australia"
                        style={{ border: `1px solid ${localeIsValid ? C.line : C.stop}`, color: C.ink }}
                        className="mt-2 w-full rounded-xl bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet/30"
                      />
                    </div>
                  )}
                </div>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={allowAdultContent}
                    onChange={event => setAllowAdultContent(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-violet"
                  />
                  <span>
                    <span style={{ color: C.ink }} className="block text-sm font-bold">Allow adult content</span>
                    <span style={{ color: C.sub }} className="mt-1 block text-xs leading-5">Off by default. Turn this on only when mature topics such as alcohol, gambling, drugs, explicit sexual content or graphic material are suitable.</span>
                  </span>
                </label>
              </div>
            )}
          </div>

          <div
            aria-live="polite"
            style={{
              background: availabilityHasError ? '#FEF2F2' : C.violetMist,
              border: `1px solid ${availabilityHasError ? '#FECACA' : C.violetPale}`,
              color: availabilityHasError ? C.stop : C.violet,
            }}
            className="rounded-xl px-4 py-3 text-xs font-semibold leading-5"
          >
            <span className="font-extrabold">Question Library availability:</span> {availabilityMessage}
          </div>

          {generateError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{generateError}</p>}
          <Btn sz="lg" cls="w-full" disabled={generating || !canGenerate} onClick={() => void generateQuiz()}>{generating ? 'Generating Draft…' : sourcesLoading ? 'Checking Question Library…' : 'Generate Draft Quiz →'}</Btn>
        </div>
      </main>
    </div>
  )
}

// ─── SCREEN 6: QUIZ REVIEW ────────────────────────────────────────────────────

const REVIEW_ROUNDS = [
  {
    id: 1, title: 'General Knowledge',
    items: [
      { id: 0, q: 'What is the capital of Australia?', cat: 'Geography', diff: 'Easy', ans: 'Canberra', type: 'Single Answer' },
      { id: 1, q: 'How many sides does a hexagon have?', cat: 'Maths', diff: 'Easy', ans: '6', type: 'Single Answer' },
      { id: 2, q: 'Who wrote Romeo and Juliet?', cat: 'Literature', diff: 'Easy', ans: 'Shakespeare', type: 'Single Answer' },
      { id: 3, q: 'What is the largest ocean on Earth?', cat: 'Geography', diff: 'Medium', ans: 'Pacific Ocean', type: 'Single Answer' },
      { id: 4, q: 'In what year did the Titanic sink?', cat: 'History', diff: 'Medium', ans: '1912', type: 'Single Answer' },
    ],
  },
  {
    id: 2, title: 'Movies',
    items: [
      { id: 5, q: "What was the highest-grossing film worldwide in 1997?", cat: 'Movies', diff: 'Easy', ans: 'Titanic', type: 'Single Answer' },
      { id: 6, q: "Which director won Best Director for Schindler's List?", cat: 'Movies', diff: 'Medium', ans: 'Steven Spielberg', type: 'Single Answer' },
      { id: 7, q: "In which year was the first Star Wars film released?", cat: 'Movies', diff: 'Easy', ans: '1977', type: 'Single Answer' },
      { id: 8, q: "Who played Iron Man in the Marvel Cinematic Universe?", cat: 'Movies', diff: 'Easy', ans: 'Robert Downey Jr.', type: 'Single Answer' },
      { id: 9, q: 'What film features the line "You had me at hello"?', cat: 'Movies', diff: 'Medium', ans: 'Jerry Maguire', type: 'Single Answer' },
    ],
  },
  {
    id: 3, title: 'Sport',
    items: [
      { id: 10, q: 'How many players are on a basketball team on the court?', cat: 'Sport', diff: 'Easy', ans: '5', type: 'Single Answer' },
      { id: 11, q: 'Which country won the 2018 FIFA World Cup?', cat: 'Sport', diff: 'Medium', ans: 'France', type: 'Single Answer' },
      { id: 12, q: 'In tennis, what is the term for a score of 40–40?', cat: 'Sport', diff: 'Medium', ans: 'Deuce', type: 'Single Answer' },
      { id: 13, q: 'How many Grand Slam titles has Serena Williams won?', cat: 'Sport', diff: 'Hard', ans: '23', type: 'Single Answer' },
      { id: 14, q: 'What sport is played at Wimbledon?', cat: 'Sport', diff: 'Easy', ans: 'Tennis', type: 'Single Answer' },
    ],
  },
  {
    id: 4, title: 'Music',
    items: [
      { id: 15, q: "Which band released 'Bohemian Rhapsody'?", cat: 'Music', diff: 'Easy', ans: 'Queen', type: 'Single Answer' },
      { id: 16, q: 'How many strings does a standard guitar have?', cat: 'Music', diff: 'Easy', ans: '6', type: 'Single Answer' },
      { id: 17, q: "Who is known as the 'King of Pop'?", cat: 'Music', diff: 'Easy', ans: 'Michael Jackson', type: 'Single Answer' },
      { id: 18, q: 'In what decade did hip-hop emerge as a genre?', cat: 'Music', diff: 'Medium', ans: '1970s', type: 'Single Answer' },
      { id: 19, q: "Which composer wrote 'The Four Seasons'?", cat: 'Music', diff: 'Medium', ans: 'Vivaldi', type: 'Single Answer' },
    ],
  },
]

function QuizReview({ go }: { go: Go }) {
  const [modal, setModal] = useState<null | 'single' | 'multi'>(null)

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      {/* Header — mirrors the builder */}
      <header style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}
        className="h-14 flex items-center px-6 gap-4 sticky top-0 z-40">
        <button onClick={() => go('auto-build')} style={{ color: C.sub }}
          className="flex items-center gap-1.5 text-sm font-medium hover:text-violet transition-colors shrink-0">
          <I.back /> Back to Settings
        </button>
        <div className="flex-1 flex justify-center">
          <span style={{ color: C.ink }} className="text-[15px] font-bold">Friday Night Trivia</span>
        </div>
        <div style={{ color: C.sub }} className="text-xs flex items-center gap-2 shrink-0">
          <span className="font-mono">20q</span>
          <span style={{ color: C.line }}>·</span>
          <span className="font-mono">4r</span>
        </div>
        <Btn sz="sm" onClick={() => go('quiz-builder')}>Save Quiz</Btn>
      </header>

      <div className="flex" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <main className="flex-1 px-6 py-7 space-y-3.5 min-w-0">
          {/* Callout */}
          <div style={{ background: C.violetMist, border: `1px solid ${C.violetPale}` }}
            className="rounded-2xl px-5 py-3.5 flex items-center gap-3">
            <I.info />
            <p style={{ color: C.violet }} className="text-sm font-medium">
              This quiz has been auto-built for you. Everything is editable — change rounds, replace questions, add your own content, or save it as-is.
            </p>
          </div>

          {REVIEW_ROUNDS.map(round => (
            <ReviewRound key={round.id} round={round} onEdit={type => setModal(type)} />
          ))}

          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p style={{ color: C.ink }} className="font-bold">Prepared Tiebreakers</p>
                <p style={{ color: C.sub }} className="mt-1 text-sm">{AUTO_BUILD_TIEBREAKER_COUNT} closest-answer questions are included separately from the scored quiz.</p>
              </div>
              <span style={{ background: C.violetMist, color: C.violet }} className="rounded-full px-3 py-1 text-xs font-bold">{AUTO_BUILD_TIEBREAKER_COUNT} included</span>
            </div>
          </div>

          <button style={{ border: `2px dashed ${C.line}` }}
            className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors hover:border-violet">
            <span style={{ color: C.sub }} className="flex items-center gap-2">
              <I.plus /> Add Round
            </span>
          </button>
        </main>

        {/* Structure sidebar */}
        <aside className="w-56 shrink-0 px-4 py-7">
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }}
            className="rounded-2xl p-4 sticky top-20">
            <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider mb-3">Quiz Structure</p>
            <div className="space-y-0.5">
              {REVIEW_ROUNDS.map(r => (
                <div key={r.id} style={{ color: C.sub }}
                  className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-ground cursor-pointer transition-colors hover:text-ink text-xs">
                  <span className="truncate"><span className="font-mono opacity-60 mr-1.5">R{r.id}</span>{r.title}</span>
                  <span className="font-mono ml-1 shrink-0">{r.items.length}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.line}` }} className="mt-3 pt-3 flex justify-between text-xs">
              <span style={{ color: C.sub }}>Total</span>
              <span style={{ color: C.ink }} className="font-bold">20 questions</span>
            </div>
          </div>
        </aside>
      </div>

      {modal && (
        <QuestionEditor
          question={prototypeEditorQuestion(modal)}
          onClose={() => setModal(null)}
          onSave={() => setModal(null)}
        />
      )}
    </div>
  )
}

function ReviewRound({ round, onEdit }: {
  round: typeof REVIEW_ROUNDS[0]; onEdit: (t: 'single' | 'multi') => void
}) {
  const [open, setOpen] = useState(true)
  const [title, setTitle] = useState(round.title)
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl overflow-hidden">
      <div style={{ background: C.ground, borderBottom: open ? `1px solid ${C.line}` : 'none' }}
        className="flex items-center gap-3 px-4 py-3">
        <span style={{ color: C.sub }} className="cursor-grab hover:text-ink transition-colors"><I.grip /></span>
        <span style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-widest shrink-0">Round {round.id}</span>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          style={{ color: C.ink, borderBottom: `2px solid transparent` }}
          className="font-bold flex-1 min-w-0 bg-transparent text-sm px-1 py-0.5 focus:outline-none focus:border-b-violet hover:border-b-line transition-colors"
        />
        <span style={{ color: C.sub }} className="text-xs font-mono">{round.items.length}q</span>
        <button onClick={() => setOpen(o => !o)} style={{ color: C.sub }} className="hover:text-ink transition-colors p-0.5">
          <I.down r={!open} />
        </button>
      </div>
      {open && (
        <div className="p-3 space-y-2">
          {round.items.map((item, i) => (
            <ReviewQuestion key={item.id} item={item} idx={i} onEdit={() => onEdit(i % 2 === 0 ? 'single' : 'multi')} />
          ))}
          <div className="flex gap-1 pt-1">
            {['Add Question', 'Add Content Screen'].map(lbl => (
              <button key={lbl} style={{ color: C.sub }}
                className="text-xs font-semibold px-2.5 py-2 rounded-lg hover:bg-violet-mist hover:text-violet transition-colors flex items-center gap-1.5">
                <I.plus /> {lbl}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ReviewQuestion({ item, idx, onEdit }: {
  item: { id: number; q: string; cat: string; diff: string; ans: string; type: string }
  idx: number; onEdit: () => void
}) {
  const [replacing, setReplacing] = useState(false)
  const doReplace = () => {
    setReplacing(true)
    setTimeout(() => setReplacing(false), 600)
  }
  return (
    <div onClick={onEdit} style={{ border: `1px solid ${C.line}`, cursor: 'pointer', opacity: replacing ? 0.4 : 1 }}
      className="flex items-start gap-3 px-3 py-3 rounded-xl hover:border-violet hover:shadow-sm hover:bg-violet-mist/30 transition-all group bg-white">
      <span style={{ color: C.sub }} className="mt-0.5 cursor-grab hover:text-ink transition-colors shrink-0" onClick={e => e.stopPropagation()}><I.grip /></span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 mb-2">
          <span style={{ color: C.sub }} className="text-[11px] font-mono shrink-0 mt-0.5">Q{idx + 1}</span>
          <p style={{ color: C.ink }} className="text-sm leading-snug group-hover:text-violet transition-colors">{item.q}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Chip>{item.cat}</Chip>
          <Chip color={difficultyChipColor(item.diff)}>{item.diff}</Chip>
          <Chip color="violet">{item.type}</Chip>
          <span style={{ color: C.sub }} className="text-[11px]">Ans: <span style={{ color: C.ink }} className="font-semibold">{item.ans}</span></span>
          <span style={{ color: C.violet }} className="text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 ml-1">
            <I.pencil /> Edit
          </span>
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
        <IBtn icon={<I.refresh />} title="Replace" onClick={doReplace} />
        <IBtn icon={<I.copy />} title="Duplicate" />
        <IBtn icon={<I.trash />} title="Delete" danger />
      </div>
    </div>
  )
}

// ─── SCREEN 7: HOST SETUP ─────────────────────────────────────────────────────

function HostSetup({ go }: { go: Go }) {
  const [reveal, setReveal] = useState<'each' | 'round'>('each')
  const [lb, setLb] = useState<LeaderboardVisibility>('round')
  const [autoRunMode, setAutoRunMode] = useState<AutoRunMode>('off')
  const [scoreVisibility, setScoreVisibility] = useState<PlayerScoreVisibility>('live')
  const [showCorrectnessPercentage, setShowCorrectnessPercentage] = useState(false)
  type PrizePlace = { enabled: boolean; msg: string }
  const topPlaces = ['1st', '2nd', '3rd']
  const bottomPlaces = ['Last', '2nd Last', '3rd Last']
  const initPrize = (msg = ''): PrizePlace => ({ enabled: false, msg })
  const [topPrizes, setTopPrizes] = useState<PrizePlace[]>([
    initPrize(), initPrize(), initPrize(),
  ])
  const [botPrizes, setBotPrizes] = useState<PrizePlace[]>([
    initPrize(), initPrize(), initPrize(),
  ])
  const [quiz, setQuiz] = useState<QuizSummary | null>(null)
  const [loadingQuiz, setLoadingQuiz] = useState(true)
  const [openingLobby, setOpeningLobby] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadQuiz() {
      setLoadingQuiz(true)
      setSetupError(null)
      const selectedId = localStorage.getItem('simple-trivia-selected-quiz-id')

      let query = supabase
        .from('quizzes')
        .select('id, title, status, round_count, question_count, estimated_minutes, updated_at')

      if (selectedId) {
        query = query.eq('id', selectedId)
      } else {
        query = query.eq('status', 'ready').order('updated_at', { ascending: false }).limit(1)
      }

      const { data, error } = await query.maybeSingle()
      if (!active) return

      if (error || !data) {
        console.error('Could not load selected quiz:', error)
        setSetupError('Could not load the quiz you selected.')
      } else {
        setQuiz(data as QuizSummary)
        localStorage.setItem('simple-trivia-selected-quiz-id', data.id)
        localStorage.setItem('simple-trivia-selected-quiz-title', data.title)
      }

      setLoadingQuiz(false)
    }

    void loadQuiz()
    return () => { active = false }
  }, [])

  async function handleOpenLobby() {
    if (!quiz || openingLobby) return
    setOpeningLobby(true)
    setSetupError(null)

    try {
      const { data: game, error: gameError } = await supabase
        .rpc('create_game_from_quiz_with_show_games', {
          p_quiz_id: quiz.id,
          p_settings: {
            answer_reveal: reveal,
            leaderboard_visibility: lb,
            auto_run_mode: autoRunMode,
            team_approval_required: true,
            player_score_visibility: scoreVisibility,
            scores_visible_to_players: scoreVisibility === 'live',
            show_correctness_percentage_to_players: showCorrectnessPercentage,
            top_prizes: topPrizes,
            bottom_prizes: botPrizes,
          },
        })
        .single()

      if (gameError) throw gameError
      localStorage.setItem('simple-trivia-host-game-id', game.game_id)
      localStorage.setItem('simple-trivia-host-game-code', game.game_code)
      localStorage.setItem('simple-trivia-host-game-title', game.game_title)
      go('lobby')
    } catch (error) {
      console.error('Could not open lobby:', error)
      setSetupError(
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String(error.message)
            : 'Could not open the lobby.',
      )
    } finally {
      setOpeningLobby(false)
    }
  }

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <Nav go={go} />
      <main className="max-w-2xl mx-auto px-6 py-10">
        <button onClick={() => go('dashboard')} style={{ color: C.sub }}
          className="flex items-center gap-1.5 text-sm hover:text-violet transition-colors mb-8">
          <I.back /> My Quizzes
        </button>
        <h1 style={{ color: C.ink }} className="text-3xl font-extrabold mb-1">Host a Game</h1>
        <div style={{ color: C.sub }} className="flex items-center gap-2 mb-8 text-sm">
          <span style={{ color: C.ink }} className="font-bold">{loadingQuiz ? 'Loading quiz…' : quiz?.title ?? 'No quiz selected'}</span>
          {quiz && <>
            <span style={{ color: C.line }}>·</span>
            <span>{quiz.question_count} questions · {quiz.round_count} rounds</span>
          </>}
        </div>

        {setupError && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA' }} className="rounded-xl px-4 py-3 mb-4">
            <p style={{ color: C.stop }} className="text-sm font-semibold">{setupError}</p>
          </div>
        )}

        <div className="space-y-4">
          <SCard title="Auto-Run">
            <p style={{ color: C.sub }} className="mb-3 text-xs leading-5">
              Run each round automatically, then stop so you can review and finalize it before starting the next round.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'off' as const, l: 'Off' },
                { v: 'round' as const, l: 'Run each round automatically' },
              ].map(option => (
                <button key={option.v} type="button" onClick={() => {
                  setAutoRunMode(option.v)
                  if (option.v === 'round') setScoreVisibility('round')
                }}
                  style={{
                    border: `1.5px solid ${autoRunMode === option.v ? C.violet : C.line}`,
                    background: autoRunMode === option.v ? C.violetMist : 'white',
                    color: autoRunMode === option.v ? C.violet : C.sub,
                  }}
                  className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-all">
                  {option.l}
                </button>
              ))}
            </div>
          </SCard>

          {/* Answer reveal */}
          <SCard title="Answer Reveal">
            <div className="space-y-1">
              {[
                { v: 'each' as const, l: 'Reveal after every question' },
                { v: 'round' as const, l: 'Reveal answers at the end of each round' },
              ].map(o => (
                <label key={o.v} className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-ground transition-colors">
                  <input type="radio" name="reveal" value={o.v} checked={reveal === o.v}
                    onChange={() => setReveal(o.v)} style={{ accentColor: C.violet }} />
                  <span style={{ color: C.ink }} className="text-sm font-medium">{o.l}</span>
                </label>
              ))}
            </div>
          </SCard>

          {/* Leaderboard */}
          <SCard title="Leaderboard Visibility to Players">
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'question' as const, l: 'Show after every question' },
                { v: 'round' as const, l: 'End of each round' },
                { v: 'final' as const, l: 'Final results only' },
                { v: 'host' as const, l: 'Never show' },
              ].map(o => (
                <button key={o.v} onClick={() => setLb(o.v)}
                  style={{
                    border: `1.5px solid ${lb === o.v ? C.violet : C.line}`,
                    background: lb === o.v ? C.violetMist : 'white',
                    color: lb === o.v ? C.violet : C.sub,
                  }}
                  className="py-2.5 px-3 rounded-xl text-sm font-semibold text-left transition-all">
                  {o.l}
                </button>
              ))}
            </div>
          </SCard>

          {/* Scores */}
          <SCard title="Score Visibility to Players">
            <p style={{ color: C.sub }} className="mb-3 text-xs leading-5">
              Choose whether players can see point totals during and after the game. This is separate from showing the leaderboard.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'live' as const, l: 'Live' },
                { v: 'round' as const, l: 'After each round is finalized' },
                { v: 'final' as const, l: 'Final results only' },
                { v: 'hidden' as const, l: 'Hidden' },
              ].map(option => (
                <button key={option.v} onClick={() => setScoreVisibility(option.v)}
                  style={{
                    border: `1.5px solid ${scoreVisibility === option.v ? C.violet : C.line}`,
                    background: scoreVisibility === option.v ? C.violetMist : 'white',
                    color: scoreVisibility === option.v ? C.violet : C.sub,
                  }}
                  className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-all">
                  {option.l}
                </button>
              ))}
            </div>
            {autoRunMode === 'round' && scoreVisibility === 'round' && (
              <p style={{ color: C.violet }} className="mt-3 text-xs font-semibold">
                Recommended for Auto-Run. Scores update after you review and finalize each round.
              </p>
            )}
          </SCard>

          <SCard title="Correct Answer Percentage">
            <p style={{ color: C.sub }} className="mb-3 text-xs leading-5">
              Hosts always see how many teams got the answer right. You can also show that percentage on player result screens.
            </p>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl p-2.5 transition-colors hover:bg-ground">
              <span style={{ color: C.ink }} className="text-sm font-semibold">Show percentage correct to players</span>
              <input
                type="checkbox"
                checked={showCorrectnessPercentage}
                onChange={event => setShowCorrectnessPercentage(event.target.checked)}
                style={{ accentColor: C.violet }}
                className="h-5 w-5"
              />
            </label>
          </SCard>

          {/* Prizes */}
          <SCard title="Prize Places & Messages">
            <div className="space-y-5">
              <div>
                <p style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-widest mb-2">Top Places</p>
                <div className="space-y-2">
                  {topPlaces.map((label, i) => (
                    <div key={label}>
                      <label className="flex items-center gap-3 cursor-pointer mb-1.5">
                        <input type="checkbox" checked={topPrizes[i].enabled}
                          onChange={e => setTopPrizes(prev => prev.map((p, j) => j === i ? { ...p, enabled: e.target.checked } : p))}
                          style={{ accentColor: C.violet }} />
                        <span style={{ color: C.ink }} className="text-sm font-semibold">{label} Place</span>
                      </label>
                      {topPrizes[i].enabled && (
                        <input
                          value={topPrizes[i].msg}
                          onChange={e => setTopPrizes(prev => prev.map((p, j) => j === i ? { ...p, msg: e.target.value } : p))}
                          placeholder="Prize message shown on final results…"
                          style={{ border: `1px solid ${C.line}`, color: C.ink }}
                          className="w-full rounded-xl px-3 py-2 text-sm bg-ground focus:outline-none focus:ring-2 focus:ring-violet/30 placeholder:text-sub ml-6"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${C.line}` }} className="pt-4">
                <p style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-widest mb-2">Last Place Prizes</p>
                <div className="space-y-2">
                  {bottomPlaces.map((label, i) => (
                    <div key={label}>
                      <label className="flex items-center gap-3 cursor-pointer mb-1.5">
                        <input type="checkbox" checked={botPrizes[i].enabled}
                          onChange={e => setBotPrizes(prev => prev.map((p, j) => j === i ? { ...p, enabled: e.target.checked } : p))}
                          style={{ accentColor: C.violet }} />
                        <span style={{ color: C.ink }} className="text-sm font-semibold">{label}</span>
                      </label>
                      {botPrizes[i].enabled && (
                        <input
                          value={botPrizes[i].msg}
                          onChange={e => setBotPrizes(prev => prev.map((p, j) => j === i ? { ...p, msg: e.target.value } : p))}
                          placeholder="Prize message shown on final results…"
                          style={{ border: `1px solid ${C.line}`, color: C.ink }}
                          className="w-full rounded-xl px-3 py-2 text-sm bg-ground focus:outline-none focus:ring-2 focus:ring-violet/30 placeholder:text-sub ml-6"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer pt-1" style={{ borderTop: `1px solid ${C.line}` }}>
                <input type="checkbox" style={{ accentColor: C.violet }} />
                <span style={{ color: C.sub }} className="text-xs font-semibold">Save as default prize settings</span>
              </label>
            </div>
          </SCard>


          <Btn sz="lg" cls="w-full" onClick={handleOpenLobby} disabled={!quiz || openingLobby}>
            {openingLobby ? 'Creating Game…' : 'Open Fresh Lobby →'}
          </Btn>
        </div>
      </main>
    </div>
  )
}

function SCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5">
      <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  )
}

// ─── SCREEN 8: LOBBY ──────────────────────────────────────────────────────────

type LobbyTeam = {
  id: string
  name: string
}

function Lobby({ go }: { go: Go }) {
  const [lobbyCode] = useState(() => getHostGameCode())
  const [lobbyTitle] = useState(() => getHostGameTitle())
  const { dataUrl: lobbyQrDataUrl } = useGameJoinQr(lobbyCode)
  const [teams, setTeams] = useState<LobbyTeam[]>([])
  const [lobbyError, setLobbyError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [lobbyGameId, setLobbyGameId] = useState<string | null>(null)
  const [lobbySettings, setLobbySettings] = useState<Record<string, Json>>({})
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [approvalBusy, setApprovalBusy] = useState(false)

  async function handleApprovalRequiredChange(required: boolean) {
    if (!lobbyGameId || approvalBusy) return
    setApprovalBusy(true)
    setLobbyError(null)
    const settings: Record<string, Json> = { ...lobbySettings, team_approval_required: required }

    const { error: updateError } = await supabase.from('games').update({ settings }).eq('id', lobbyGameId)
    if (updateError) {
      console.error('Could not update team approval setting:', updateError)
      setLobbyError('Could not update team approval. Please try again.')
      setApprovalBusy(false)
      return
    }

    setLobbySettings(settings)
    setApprovalRequired(required)

    if (!required) {
      const { data: pending, error: pendingError } = await supabase
        .from('team_join_requests')
        .select('id')
        .eq('game_id', lobbyGameId)
        .eq('status', 'pending')

      if (pendingError) {
        console.error('Could not load waiting teams for automatic approval:', pendingError)
        setLobbyError('Automatic entry is on, but waiting teams could not be admitted. Please try again.')
      } else {
        for (const request of pending ?? []) {
          const { error: decisionError } = await supabase.rpc('decide_team_join_request', {
            p_request_id: request.id,
            p_decision: 'approved',
          })
          if (decisionError) {
            console.error('Could not automatically approve a waiting team:', decisionError)
            setLobbyError('Automatic entry is on, but one waiting team could not be admitted.')
            break
          }
        }
      }
    }

    setApprovalBusy(false)
  }

  async function handleStartQuiz() {
    if (starting) return

    setStarting(true)
    setStartError(null)

    try {
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('id')
        .eq('code', lobbyCode)
        .maybeSingle()

      if (gameError || !game) {
        throw gameError ?? new Error('Game not found')
      }

      const { data: firstQuestion, error: questionError } = await supabase
        .from('game_questions')
        .select('question_key')
        .eq('game_id', game.id)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (questionError || !firstQuestion) {
        throw questionError ?? new Error('No questions found for this game')
      }

      const { error: clearError } = await supabase
        .from('submissions')
        .delete()
        .eq('game_id', game.id)

      if (clearError) throw clearError

      const { error: scoreError } = await supabase
        .from('teams')
        .update({ score: 0 })
        .eq('game_id', game.id)

      if (scoreError) throw scoreError

      await updateLiveGame({
        status: 'live',
        current_screen: 'round-start',
        answer_phase: 'open',
        answer_editing_allowed: false,
        current_question_key: firstQuestion.question_key,
        current_content_screen_key: null,
      })

      go('live-question')
    } catch (error) {
      console.error('Could not start quiz:', error)
      setStartError('Could not start the quiz. Please try again.')
      setStarting(false)
    }
  }

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function setupLobby() {
      setLobbyError(null)

      const { data: game, error: gameError } = await supabase
        .from("games")
        .select("id, settings")
        .eq("code", lobbyCode)
        .maybeSingle()

      if (!active) return

      if (gameError || !game) {
        console.error("Could not find lobby game:", gameError)
        setLobbyError("Could not load this lobby.")
        return
      }

      const settings = game.settings && typeof game.settings === 'object' && !Array.isArray(game.settings)
        ? game.settings as Record<string, Json>
        : {}
      setLobbyGameId(game.id)
      setLobbySettings(settings)
      setApprovalRequired(teamApprovalRequiredFromSettings(settings))

      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("game_id", game.id)
        .order("created_at", { ascending: true })

      if (!active) return

      if (error) {
        console.error("Could not load teams:", error)
        setLobbyError("Could not load teams.")
      } else {
        setTeams(data ?? [])
      }

      channel = supabase
        .channel(`lobby-teams-${game.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "teams",
            filter: `game_id=eq.${game.id}`,
          },
          (payload) => {
            const newTeam = payload.new as LobbyTeam

            setTeams((current) => {
              if (current.some((team) => team.id === newTeam.id)) {
                return current
              }

              return [...current, newTeam]
            })
          }
        )
        .subscribe()
    }

    void setupLobby()

    return () => {
      active = false

      if (channel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [lobbyCode])

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <header style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}
        className="h-14 flex items-center px-6 gap-4">
        <div className="flex items-center gap-2.5">
          <BrandWordmark compact className="text-sm" />
        </div>
        <div className="flex-1" />
        <Chip color="ready">
          <span style={{ background: C.go }} className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" />
          Lobby Open
        </Chip>
        <Btn v="ghost" sz="sm" onClick={() => go('host-setup')}>Settings</Btn>
        <Btn v="ghost" sz="sm" onClick={() => exitHostSession(go)}>Exit to My Quizzes</Btn>
        <CancelGameButton go={go} />
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="text-center mb-10">
          <h1 style={{ color: C.ink }} className="text-3xl font-extrabold mb-1">{lobbyTitle}</h1>
          <p style={{ color: C.sub }} className="text-sm">Share the code or QR so teams can join on their phones.</p>
        </div>

        <div className="grid grid-cols-2 gap-8 items-start">
          {/* Code + QR */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-8 flex flex-col items-center text-center">
            <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-widest mb-4">Game Code</p>
            <div style={{ color: C.ink, letterSpacing: '0.2em' }} className="text-6xl font-extrabold mb-7 tabular-nums">
              {lobbyCode}
            </div>
            <div style={{ background: C.ground, border: `1px solid ${C.line}` }}
              className="w-44 h-44 rounded-2xl mb-6 flex items-center justify-center overflow-hidden">
              <QrGraphic dataUrl={lobbyQrDataUrl} size={176} />
            </div>
            <div className="flex gap-2">
              <JoinCodeButton label="Display QR" />
              <Btn v="secondary" sz="sm" onClick={() => downloadGameQr(lobbyQrDataUrl, lobbyCode)} disabled={!lobbyQrDataUrl}>Download QR</Btn>
            </div>
          </div>

          {/* Teams */}
          <div>
            <div className="mb-5">
              <TeamAdmissionList
                gameCode={lobbyCode}
                approvalRequired={approvalRequired}
                approvalBusy={approvalBusy}
                onApprovalRequiredChange={required => { void handleApprovalRequiredChange(required) }}
              />
            </div>
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ color: C.ink }} className="font-extrabold">Teams Joined</h2>
              <div className="flex items-center gap-2">
                <span style={{ background: C.go }} className="w-2 h-2 rounded-full animate-pulse inline-block" />
                <span style={{ color: C.ink }} className="font-bold text-lg">{teams.length}</span>
                <span style={{ color: C.sub }} className="text-sm">teams</span>
              </div>
            </div>
            {lobbyError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}
                className="rounded-xl px-3 py-2.5 mb-3">
                <p style={{ color: C.stop }} className="text-xs font-semibold">{lobbyError}</p>
              </div>
            )}
            <div className="space-y-2 mb-6">
              {teams.length === 0 && !lobbyError && (
                <div style={{ background: C.panel, border: `1px dashed ${C.line}` }}
                  className="rounded-xl px-4 py-5 text-center">
                  <p style={{ color: C.sub }} className="text-sm">Waiting for teams to join…</p>
                </div>
              )}
              {teams.map((t, i) => (
                <div key={t.id} style={{ background: C.panel, border: `1px solid ${C.line}` }}
                  className="flex items-center gap-3 p-3 rounded-xl">
                  <div style={{ background: C.violetPale, color: C.violet }}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 font-mono">
                    {i + 1}
                  </div>
                  <span style={{ color: C.ink }} className="text-sm font-semibold flex-1 truncate">{t.name}</span>
                  <span style={{ background: C.go }} className="w-2 h-2 rounded-full shrink-0" />
                </div>
              ))}
            </div>
            {startError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}
                className="rounded-xl px-3 py-2.5 mb-3">
                <p style={{ color: C.stop }} className="text-xs font-semibold">{startError}</p>
              </div>
            )}
            <Btn sz="lg" cls="w-full" onClick={handleStartQuiz} disabled={starting || teams.length === 0} hostNavigation="forward">
              {starting ? 'Starting Quiz…' : 'Start Quiz'}
            </Btn>
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── SCREEN 9: LIVE QUESTION ──────────────────────────────────────────────────
// Dark operational mode — now backed by the live question sequence in Supabase.

type LiveTeam = {
  id: string
  name: string
  score: number
  prize_awards?: Json
  final_placement?: number | null
  final_bottom_placement?: number | null
  final_sort_order?: number | null
}

type LiveSubmission = {
  id: string
  team_id: string
  question_key?: string
  answer_text: string
  is_correct: boolean | null
  points_awarded: number
  grading_json: SubmissionGrading | null
}

type LiveBonusSubmission = LiveSubmission

type LiveQuestionDefinition = {
  question_key: string
  position: number
  item_position: number
  round_number: number
  round_position: number
  round_question_count: number
  round_title: string
  prompt: string
  category: string | null
  difficulty: string | null
  question_type: string
  correct_answer: unknown
  accepted_answers: unknown
  options: unknown
  image_url: string | null
  points_max: number
  bonus: Json | null
  notes: string | null
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

type LiveShowGameDefinition = {
  id: string
  show_game_key: string
  item_position: number
  round_number: number
  round_title: string
  game_type: 'beat-the-bomb'
  title: string
  settings: Json
  status: 'ready' | 'open' | 'exploded' | 'cancelled'
  started_at: string | null
  explode_at: string | null
  winner_team_id: string | null
}

type LiveSequenceItem =
  | { kind: 'question'; itemPosition: number; roundNumber: number; question: LiveQuestionDefinition }
  | { kind: 'content'; itemPosition: number; roundNumber: number; content: LiveContentScreenDefinition }
  | { kind: 'show-game'; itemPosition: number; roundNumber: number; showGame: LiveShowGameDefinition }

function liveSequenceItems(questions: LiveQuestionDefinition[], contentScreens: LiveContentScreenDefinition[], showGames: LiveShowGameDefinition[] = []): LiveSequenceItem[] {
  return [
    ...questions.map(question => ({ kind: 'question' as const, itemPosition: question.item_position, roundNumber: question.round_number, question })),
    ...contentScreens.map(content => ({ kind: 'content' as const, itemPosition: content.item_position, roundNumber: content.round_number, content })),
    ...showGames.map(showGame => ({ kind: 'show-game' as const, itemPosition: showGame.item_position, roundNumber: showGame.round_number, showGame })),
  ].sort((a, b) => a.itemPosition - b.itemPosition)
}

type HostQuestionDetail = {
  label: string
  text: string
}

function hostQuestionDetails(question: LiveQuestionDefinition | null): HostQuestionDetail[] {
  if (!question) return []

  if (question.question_type === 'multi-part') {
    return questionOptions(question.options).map((item, index) => ({
      label: item.label ?? String.fromCharCode(65 + index),
      text: item.clue ?? item.label ?? '',
    })).filter(item => item.text)
  }

  if (question.question_type === 'multiple-choice') {
    return questionOptions(question.options).map((item, index) => ({
      label: item.key ?? String.fromCharCode(65 + index),
      text: item.label ?? '',
    })).filter(item => item.text)
  }

  if (question.question_type === 'ranking') {
    return asStringArray(question.options).map((item, index) => ({
      label: String(index + 1),
      text: item,
    }))
  }

  return []
}

function correctAnswerDisplay(question: LiveQuestionDefinition | null) {
  if (!question) return '—'

  if (question.question_type === 'multiple-choice') {
    const key = String(question.correct_answer ?? '')
    const match = questionOptions(question.options).find(option => option.key === key)
    return match?.label ? `${key} · ${match.label}` : key
  }

  if (Array.isArray(question.correct_answer)) {
    return question.correct_answer.map(item => String(item)).join(' · ')
  }

  return String(question.correct_answer ?? '—')
}

function submissionDisplay(question: LiveQuestionDefinition | null, answerText: string) {
  if (!question) return answerText
  const parsed = parseStoredAnswer(answerText)

  if (question.question_type === 'multiple-choice') {
    const key = String(parsed ?? '')
    const match = questionOptions(question.options).find(option => option.key === key)
    return match?.label ? `${key} · ${match.label}` : key
  }

  if (Array.isArray(parsed)) {
    return parsed.map(item => String(item)).join(' · ')
  }

  return String(parsed ?? '')
}

function ReviewBadge({
  status,
  onCorrect,
  onIncorrect,
  disabled = false,
}: {
  status: ReviewStatus
  onCorrect: () => void
  onIncorrect: () => void
  disabled?: boolean
}) {
  if (status === 'review' && !disabled) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <button
          data-host-review-control
          onClick={event => { event.currentTarget.blur(); onCorrect() }}
          style={{ background: C.go, color: 'white' }}
          className="rounded-lg px-3 py-2 text-xs font-extrabold hover:opacity-90"
          title="Mark correct"
        >
          ✓ Correct
        </button>
        <button
          data-host-review-control
          onClick={event => { event.currentTarget.blur(); onIncorrect() }}
          style={{ background: C.stop, color: 'white' }}
          className="rounded-lg px-3 py-2 text-xs font-extrabold hover:opacity-90"
          title="Mark incorrect"
        >
          ✕ Incorrect
        </button>
      </div>
    )
  }

  const correct = status === 'correct'

  return (
    <button
      data-host-review-control
      onClick={event => {
        event.currentTarget.blur()
        if (correct) onIncorrect()
        else onCorrect()
      }}
      disabled={disabled}
      style={{
        background: correct ? `${C.go}25` : `${C.stop}20`,
        color: correct ? C.go : C.stop,
        border: `1px solid ${correct ? `${C.go}45` : `${C.stop}40`}`,
      }}
      className="flex min-w-[104px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-extrabold disabled:cursor-default hover:opacity-80 disabled:hover:opacity-100"
      title={disabled ? undefined : correct ? 'Click to mark incorrect' : 'Click to mark correct'}
    >
      <span>{correct ? '✓' : '✕'}</span>
      <span>{correct ? 'Correct' : 'Incorrect'}</span>
    </button>
  )
}
function LiveQuestion({ go }: { go: Go }) {
  const [phase, setPhase] = useState<'open' | 'closed' | 'revealed'>('open')
  const [questionStage, setQuestionStage] = useState<'core' | 'bonus'>('core')
  const [gameScreen, setGameScreen] = useState('round-start')
  const [emergency, setEmergency] = useState(false)
  const [liveGameId, setLiveGameId] = useState<string | null>(null)
  const [teams, setTeams] = useState<LiveTeam[]>([])
  const [submissions, setSubmissions] = useState<LiveSubmission[]>([])
  const [bonusSubmissions, setBonusSubmissions] = useState<LiveBonusSubmission[]>([])
  const [question, setQuestion] = useState<LiveQuestionDefinition | null>(null)
  const [allQuestions, setAllQuestions] = useState<LiveQuestionDefinition[]>([])
  const [contentScreen, setContentScreen] = useState<LiveContentScreenDefinition | null>(null)
  const [allContentScreens, setAllContentScreens] = useState<LiveContentScreenDefinition[]>([])
  const [showGame, setShowGame] = useState<LiveShowGameDefinition | null>(null)
  const [allShowGames, setAllShowGames] = useState<LiveShowGameDefinition[]>([])
  const [showGamePresses, setShowGamePresses] = useState<Array<{ team_id: string; pressed_at: string }>>([])
  const [showGameNow, setShowGameNow] = useState(() => Date.now())
  const [leaderboardVisibility, setLeaderboardVisibility] = useState<LeaderboardVisibility>('round')
  const [answerRevealMode, setAnswerRevealMode] = useState<AnswerRevealMode>('each')
  const [autoRunMode, setAutoRunMode] = useState<AutoRunMode>('off')
  const [autoRunOperating, setAutoRunOperating] = useState(false)
  const [autoRunPaused, setAutoRunPaused] = useState(false)
  const [autoRunRemaining, setAutoRunRemaining] = useState(0)
  const autoRunInitializedRef = useRef(false)
  const autoRunActionRef = useRef<() => void>(() => {})
  const autoRunPublishedKeyRef = useRef('')
  const liveGameSettingsRef = useRef<Record<string, Json>>({})
  const [liveError, setLiveError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function loadLiveData() {
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('id, answer_phase, question_stage, current_question_key, current_content_screen_key, current_show_game_key, current_screen, settings')
        .eq('code', getHostGameCode())
        .maybeSingle()

      if (!active) return

      if (gameError || !game) {
        console.error('Could not load live game:', gameError)
        setLiveError('Could not load the live game.')
        return
      }

      setLiveGameId(game.id)
      liveGameSettingsRef.current = game.settings && typeof game.settings === 'object' && !Array.isArray(game.settings)
        ? game.settings as Record<string, Json>
        : {}
      setGameScreen(game.current_screen ?? '')
      setLeaderboardVisibility(leaderboardVisibilityFromSettings(game.settings))
      setAnswerRevealMode(answerRevealModeFromSettings(game.settings))
      const configuredAutoRun = autoRunModeFromSettings(game.settings)
      setAutoRunMode(configuredAutoRun)
      if (!autoRunInitializedRef.current) {
        autoRunInitializedRef.current = true
        setAutoRunOperating(configuredAutoRun === 'round')
      }
      setQuestionStage(game.question_stage === 'bonus' ? 'bonus' : 'core')

      if (game.answer_phase === 'open' || game.answer_phase === 'closed' || game.answer_phase === 'revealed') {
        setPhase(game.answer_phase)
      }

      const [questionResult, contentScreenResult, showGameResult, teamResult] = await Promise.all([
        supabase
          .from('game_questions')
          .select('question_key, position, item_position, round_number, round_position, round_question_count, round_title, prompt, category, difficulty, question_type, correct_answer, accepted_answers, options, image_url, points_max, bonus, notes')
          .eq('game_id', game.id)
          .order('position', { ascending: true }),
        supabase
          .from('game_content_screens')
          .select('screen_key, item_position, round_number, round_title, title, body, image_url')
          .eq('game_id', game.id)
          .order('item_position', { ascending: true }),
        supabase
          .from('game_show_games')
          .select('id, show_game_key, item_position, round_number, round_title, game_type, title, settings, status, started_at, explode_at, winner_team_id')
          .eq('game_id', game.id)
          .order('item_position', { ascending: true }),
        supabase
          .from('teams')
          .select('id, name, score')
          .eq('game_id', game.id)
          .order('created_at', { ascending: true }),
      ])

      if (!active) return

      if (questionResult.error || contentScreenResult.error || showGameResult.error || teamResult.error) {
        console.error('Could not load live question data:', questionResult.error ?? contentScreenResult.error ?? showGameResult.error ?? teamResult.error)
        setLiveError('Could not load the live question.')
        return
      }

      const questions = (questionResult.data ?? []) as LiveQuestionDefinition[]
      const contentScreens = (contentScreenResult.data ?? []) as LiveContentScreenDefinition[]
      const showGames = (showGameResult.data ?? []) as LiveShowGameDefinition[]
      const currentQuestion = questions.find(item => item.question_key === game.current_question_key) ?? questions[0] ?? null
      const currentContentScreen = contentScreens.find(item => item.screen_key === game.current_content_screen_key) ?? null
      const currentShowGame = showGames.find(item => item.show_game_key === game.current_show_game_key) ?? null

      setAllQuestions(questions)
      setAllContentScreens(contentScreens)
      setAllShowGames(showGames)
      setQuestion(currentQuestion)
      setContentScreen(currentContentScreen)
      setShowGame(currentShowGame)
      setTeams((teamResult.data ?? []) as LiveTeam[])

      if (currentShowGame) {
        const { data: pressRows, error: pressError } = await supabase
          .from('game_show_game_presses')
          .select('team_id, pressed_at')
          .eq('game_show_game_id', currentShowGame.id)
          .order('pressed_at', { ascending: true })
        if (pressError) console.error('Could not load show-game presses:', pressError)
        else setShowGamePresses(pressRows ?? [])
      } else setShowGamePresses([])

      if (currentQuestion) {
        const [submissionResult, bonusSubmissionResult] = await Promise.all([
          supabase
            .from('submissions')
            .select('id, team_id, answer_text, is_correct, points_awarded, grading_json')
            .eq('game_id', game.id)
            .eq('question_key', currentQuestion.question_key)
            .order('created_at', { ascending: true }),
          supabase
            .from('bonus_submissions')
            .select('id, team_id, answer_text, is_correct, points_awarded, grading_json')
            .eq('game_id', game.id)
            .eq('question_key', currentQuestion.question_key)
            .order('created_at', { ascending: true }),
        ])

        if (!active) return

        if (submissionResult.error || bonusSubmissionResult.error) {
          console.error('Could not load team answers:', submissionResult.error ?? bonusSubmissionResult.error)
          setLiveError('Could not load team answers.')
          return
        }

        setSubmissions((submissionResult.data ?? []) as LiveSubmission[])
        setBonusSubmissions((bonusSubmissionResult.data ?? []) as LiveBonusSubmission[])
      } else {
        setSubmissions([])
        setBonusSubmissions([])
      }

      setLiveError(null)

      if (!channel) {
        channel = supabase
          .channel(`host-live-question-${game.id}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'game_show_games', filter: `game_id=eq.${game.id}` },
            () => { void loadLiveData() },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'game_show_game_presses', filter: `game_id=eq.${game.id}` },
            () => { void loadLiveData() },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'submissions', filter: `game_id=eq.${game.id}` },
            () => { void loadLiveData() },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'bonus_submissions', filter: `game_id=eq.${game.id}` },
            () => { void loadLiveData() },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${game.id}` },
            () => { void loadLiveData() },
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${game.id}` },
            () => { void loadLiveData() },
          )
          .subscribe()
      }
    }

    void loadLiveData()

    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  const activeShowGameId = showGame?.id ?? null
  const activeShowGameStatus = showGame?.status ?? null
  const activeShowGameExplodeAt = showGame?.explode_at ?? null

  useEffect(() => {
    if (!activeShowGameId || activeShowGameStatus !== 'open' || !activeShowGameExplodeAt) return
    const interval = window.setInterval(() => setShowGameNow(Date.now()), 100)
    const delay = Math.max(0, new Date(activeShowGameExplodeAt).getTime() - Date.now())
    const timeout = window.setTimeout(() => {
      void supabase.rpc('resolve_beat_the_bomb', { p_game_show_game_id: activeShowGameId })
        .then(({ error }) => { if (error) console.error('Could not resolve Beat the Bomb:', error) })
    }, delay + 50)
    return () => { window.clearInterval(interval); window.clearTimeout(timeout) }
  }, [activeShowGameExplodeAt, activeShowGameId, activeShowGameStatus])

  async function openShowGame(nextShowGame: LiveShowGameDefinition) {
    await updateLiveGame({
      status: 'live',
      current_screen: 'show-game',
      answer_phase: 'closed',
      current_content_screen_key: null,
      current_show_game_key: nextShowGame.show_game_key,
    })
    const { data, error } = await supabase.rpc('start_beat_the_bomb', { p_game_show_game_id: nextShowGame.id })
    if (error) throw error
    setShowGame(data as LiveShowGameDefinition)
    setShowGamePresses([])
    setGameScreen('show-game')
    setPhase('closed')
  }

  async function handleOpenQuestion() {
    if (!question || actionBusy) return
    setActionBusy(true)
    setLiveError(null)

    try {
      const firstRoundItem = liveSequenceItems(allQuestions, allContentScreens, allShowGames)
        .find(item => item.roundNumber === question.round_number) ?? null

      if (firstRoundItem?.kind === 'content') {
        await updateLiveGame({
          status: 'live',
          current_screen: 'content-screen',
          answer_phase: 'closed',
          current_content_screen_key: firstRoundItem.content.screen_key,
        })
        setContentScreen(firstRoundItem.content)
        setGameScreen('content-screen')
        setPhase('closed')
        return
      }

      if (firstRoundItem?.kind === 'show-game') {
        await openShowGame(firstRoundItem.showGame)
        return
      }

      const openingQuestion = firstRoundItem?.kind === 'question' ? firstRoundItem.question : question
      await updateLiveGame({
        status: 'live',
        current_screen: openingQuestion.question_type,
        answer_phase: 'open',
        answer_editing_allowed: false,
        question_stage: 'core',
        current_question_key: openingQuestion.question_key,
        current_content_screen_key: null,
        current_show_game_key: null,
      })
      setQuestion(openingQuestion)
      setGameScreen(openingQuestion.question_type)
      setPhase('open')
      setQuestionStage('core')
    } catch (error) {
      console.error('Could not open question:', error)
      setLiveError('Could not open the question. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleCloseAnswers() {
    if (!liveGameId || actionBusy) return
    setActionBusy(true)
    setLiveError(null)

    const { error } = await supabase
      .from('games')
      .update({ answer_phase: 'closed' })
      .eq('id', liveGameId)

    if (error) {
      console.error('Could not close answers:', error)
      setLiveError('Could not close answers. Please try again.')
    } else {
      setPhase('closed')
    }

    setActionBusy(false)
  }

  async function handleShowBonus() {
    if (!liveGameId || !question || !runtimeBonusFromJson(question.bonus) || actionBusy || phase !== 'closed' || questionStage !== 'core') return
    setActionBusy(true)
    setLiveError(null)

    const { error } = await supabase
      .from('games')
      .update({ question_stage: 'bonus', answer_phase: 'open', answer_editing_allowed: false })
      .eq('id', liveGameId)

    if (error) {
      console.error('Could not show bonus question:', error)
      setLiveError('Could not show the bonus question. Please try again.')
    } else {
      setQuestionStage('bonus')
      setPhase('open')
    }

    setActionBusy(false)
  }

  async function handleReopenAnswers() {
    if (!liveGameId || actionBusy || phase !== 'closed') return
    setActionBusy(true)
    setLiveError(null)

    const { error } = await supabase
      .from('games')
      .update({ answer_phase: 'open', answer_editing_allowed: true })
      .eq('id', liveGameId)

    if (error) {
      console.error('Could not reopen answers:', error)
      setLiveError('Could not reopen answers. Please try again.')
    } else {
      setPhase('open')
    }

    setActionBusy(false)
  }


async function handleReviewItem(submissionId: string, itemIndex: number, status: 'correct' | 'incorrect') {
  if (!question || phase === 'revealed') return

  const submission = submissions.find(item => item.id === submissionId)
  if (!submission) return

  const current = storedSubmissionGrading(question, submission)
  const next: SubmissionGrading = {
    items: current.items.map((item, index) => index === itemIndex ? { ...item, status } : item),
  }

  if (question.question_type === 'multi-answer') {
    next.missing = multiAnswerMissing(question, next)
  }

  setSubmissions(currentSubmissions => currentSubmissions.map(item =>
    item.id === submissionId ? { ...item, grading_json: next } : item
  ))

  const { error } = await supabase
    .from('submissions')
    .update({ grading_json: next })
    .eq('id', submissionId)

  if (error) {
    console.error('Could not update answer review:', error)
    setLiveError('Could not save that answer review. Please try again.')
  }
}

  async function handleBonusReview(submissionId: string, status: 'correct' | 'incorrect') {
    const bonus = runtimeBonusFromJson(question?.bonus)
    if (!bonus || phase === 'revealed') return

    const submission = bonusSubmissions.find(item => item.id === submissionId)
    if (!submission) return

    const current = storedBonusGrading(bonus, submission)
    const next: SubmissionGrading = {
      items: current.items.map((item, index) => index === 0 ? { ...item, status } : item),
    }

    setBonusSubmissions(currentSubmissions => currentSubmissions.map(item =>
      item.id === submissionId ? { ...item, grading_json: next } : item
    ))

    const { error } = await supabase
      .from('bonus_submissions')
      .update({ grading_json: next })
      .eq('id', submissionId)

    if (error) {
      console.error('Could not update bonus review:', error)
      setLiveError('Could not save that bonus review. Please try again.')
    }
  }

  async function scoreCurrentQuestion(revealNow: boolean, allowPendingReview = false) {
    if (!liveGameId || !question) throw new Error('Live question is not available')

    const { data: freshSubmissions, error: submissionError } = await supabase
      .from('submissions')
      .select('id, team_id, answer_text, is_correct, points_awarded, grading_json')
      .eq('game_id', liveGameId)
      .eq('question_key', question.question_key)

    if (submissionError) throw submissionError

    const { data: freshBonusSubmissions, error: bonusSubmissionError } = await supabase
      .from('bonus_submissions')
      .select('id, team_id, answer_text, is_correct, points_awarded, grading_json')
      .eq('game_id', liveGameId)
      .eq('question_key', question.question_key)

    if (bonusSubmissionError) throw bonusSubmissionError

    const results = allowPendingReview
      ? buildConfidentRevealResults(question, (freshSubmissions ?? []) as LiveSubmission[])
      : buildRevealResults(question, (freshSubmissions ?? []) as LiveSubmission[])
    const bonusResults = (allowPendingReview ? buildConfidentBonusRevealResults : buildBonusRevealResults)(
      runtimeBonusFromJson(question.bonus),
      (freshBonusSubmissions ?? []) as LiveBonusSubmission[],
    )
    const { error: scoringError } = await supabase.rpc(allowPendingReview
      ? 'finalize_auto_run_question_scoring'
      : 'finalize_question_and_bonus_scoring', {
      p_game_id: liveGameId,
      p_question_key: question.question_key,
      p_results: results as unknown as Json,
      p_bonus_results: bonusResults as unknown as Json,
      p_reveal: revealNow,
    })

    if (scoringError) throw scoringError

    const [submissionResult, bonusSubmissionResult, teamResult] = await Promise.all([
      supabase
        .from('submissions')
        .select('id, team_id, answer_text, is_correct, points_awarded, grading_json')
        .eq('game_id', liveGameId)
        .eq('question_key', question.question_key)
        .order('created_at', { ascending: true }),
      supabase
        .from('bonus_submissions')
        .select('id, team_id, answer_text, is_correct, points_awarded, grading_json')
        .eq('game_id', liveGameId)
        .eq('question_key', question.question_key)
        .order('created_at', { ascending: true }),
      supabase
        .from('teams')
        .select('id, name, score')
        .eq('game_id', liveGameId)
        .order('created_at', { ascending: true }),
    ])

    const refreshError = submissionResult.error || bonusSubmissionResult.error || teamResult.error
    if (refreshError) {
      console.error('Question scored, but the refreshed results could not be loaded:', refreshError)
    } else {
      setSubmissions((submissionResult.data ?? []) as LiveSubmission[])
      setBonusSubmissions((bonusSubmissionResult.data ?? []) as LiveBonusSubmission[])
      setTeams((teamResult.data ?? []) as LiveTeam[])
    }
  }

  async function handleRevealAnswer() {
    if (!liveGameId || !question || actionBusy || reviewCount > 0) return
    setActionBusy(true)
    setLiveError(null)

    try {
      await scoreCurrentQuestion(true)
      setPhase('revealed')
    } catch (error) {
      console.error('Could not reveal answer:', error)
      setLiveError('Could not reveal and score the answer. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleAutoRunReveal() {
    if (!liveGameId || !question || actionBusy) return
    setActionBusy(true)
    setLiveError(null)
    try {
      await updateLiveGame({ answer_phase: 'revealed' })
      setPhase('revealed')
    } catch (error) {
      console.error('Could not Auto-Run scoring and reveal:', error)
      setLiveError('Auto-Run paused because this answer could not be scored safely.')
      setAutoRunPaused(true)
    } finally {
      setActionBusy(false)
    }
  }

  async function handleScoreAndContinue() {
    if (!liveGameId || !question || actionBusy || reviewCount > 0) return
    setActionBusy(true)
    setLiveError(null)

    try {
      await scoreCurrentQuestion(false)
      const nextItem = liveSequenceItems(allQuestions, allContentScreens, allShowGames)
        .find(item => item.itemPosition > question.item_position) ?? null
      const roundIsComplete = !nextItem || nextItem.roundNumber !== question.round_number

      if (roundIsComplete) {
        const firstRoundQuestion = allQuestions
          .filter(item => item.round_number === question.round_number)
          .sort((a, b) => a.round_position - b.round_position)[0] ?? question

        await updateLiveGame({
          status: nextItem ? 'live' : 'finished',
          current_screen: 'delayed-reveal',
          answer_phase: 'revealed',
          current_question_key: firstRoundQuestion.question_key,
          current_content_screen_key: null,
        })
        go('end-of-round')
        return
      }

      if (showsLeaderboardAfterQuestion(leaderboardVisibility)) {
        await updateLiveGame({
          current_screen: 'question-results',
          answer_phase: 'closed',
          current_question_key: question.question_key,
          current_content_screen_key: null,
        })
        setGameScreen('question-results')
        setPhase('closed')
        return
      }

      if (nextItem.kind === 'content') {
        await updateLiveGame({
          current_screen: 'content-screen',
          answer_phase: 'closed',
          current_content_screen_key: nextItem.content.screen_key,
        })
        setContentScreen(nextItem.content)
        setGameScreen('content-screen')
        setPhase('closed')
        return
      }
      if (nextItem.kind === 'show-game') {
        await openShowGame(nextItem.showGame)
        return
      }

      await updateLiveGame({
        current_screen: nextItem.question.question_type,
        answer_phase: 'open',
        answer_editing_allowed: false,
        question_stage: 'core',
        current_question_key: nextItem.question.question_key,
        current_content_screen_key: null,
      })
      setQuestion(nextItem.question)
      setPhase('open')
      setQuestionStage('core')
      setGameScreen(nextItem.question.question_type)
      setSubmissions([])
      setBonusSubmissions([])
    } catch (error) {
      console.error('Could not score and advance:', error)
      setLiveError('Could not score and continue. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleAdvance() {
    if (!question || actionBusy) return
    setActionBusy(true)
    setLiveError(null)

    try {
      const nextItem = liveSequenceItems(allQuestions, allContentScreens, allShowGames)
        .find(item => item.itemPosition > question.item_position) ?? null

      if (!nextItem) {
        if (!liveGameId) throw new Error('The live game could not be found.')
        if (autoRunMode === 'round') {
          await updateLiveGame({
            current_screen: 'intermission',
            answer_phase: 'closed',
            current_question_key: question.question_key,
            current_content_screen_key: null,
          })
          go('end-of-round')
          return
        }
        await finalizeLiveGame(liveGameId)
        go('final-results')
        return
      }

      if (nextItem.roundNumber !== question.round_number) {
        await updateLiveGame({
          current_screen: autoRunMode === 'round' ? 'intermission' : roundResultsScreen(leaderboardVisibility),
          answer_phase: 'closed',
          current_question_key: question.question_key,
          current_content_screen_key: null,
        })
        go('end-of-round')
        return
      }

      if (showsLeaderboardAfterQuestion(leaderboardVisibility) && gameScreen !== 'question-results') {
        await updateLiveGame({
          current_screen: 'question-results',
          answer_phase: 'revealed',
          current_question_key: question.question_key,
          current_content_screen_key: null,
        })
        setGameScreen('question-results')
        return
      }

      if (nextItem.kind === 'content') {
        await updateLiveGame({
          current_screen: 'content-screen',
          answer_phase: 'closed',
          current_content_screen_key: nextItem.content.screen_key,
        })
        setContentScreen(nextItem.content)
        setGameScreen('content-screen')
        setPhase('closed')
        return
      }
      if (nextItem.kind === 'show-game') {
        await openShowGame(nextItem.showGame)
        return
      }

      await updateLiveGame({
        current_screen: nextItem.question.question_type,
        answer_phase: 'open',
        answer_editing_allowed: false,
        question_stage: 'core',
        current_question_key: nextItem.question.question_key,
        current_content_screen_key: null,
      })
      setQuestion(nextItem.question)
      setPhase('open')
      setQuestionStage('core')
      setGameScreen(nextItem.question.question_type)
      setSubmissions([])
      setBonusSubmissions([])
    } catch (error) {
      console.error('Could not advance the game:', error)
      setLiveError('Could not advance the game. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleAdvanceContentScreen() {
    if (!contentScreen || actionBusy) return
    setActionBusy(true)
    setLiveError(null)

    try {
      const nextItem = liveSequenceItems(allQuestions, allContentScreens, allShowGames)
        .find(item => item.itemPosition > contentScreen.item_position) ?? null

      if (answerRevealMode === 'round' && (!nextItem || nextItem.roundNumber !== contentScreen.round_number)) {
        const firstRoundQuestion = allQuestions
          .filter(item => item.round_number === contentScreen.round_number)
          .sort((a, b) => a.round_position - b.round_position)[0] ?? null

        if (firstRoundQuestion) {
          await updateLiveGame({
            status: nextItem ? 'live' : 'finished',
            current_screen: 'delayed-reveal',
            answer_phase: 'revealed',
            current_question_key: firstRoundQuestion.question_key,
            current_content_screen_key: null,
          })
          go('end-of-round')
          return
        }
      }

      if (!nextItem) {
        if (!liveGameId) throw new Error('The live game could not be found.')
        if (autoRunMode === 'round') {
          await updateLiveGame({
            current_screen: 'intermission',
            answer_phase: 'closed',
            current_content_screen_key: null,
          })
          go('end-of-round')
          return
        }
        await finalizeLiveGame(liveGameId)
        go('final-results')
        return
      }

      if (nextItem.roundNumber !== contentScreen.round_number) {
        await updateLiveGame({
          current_screen: autoRunMode === 'round' ? 'intermission' : roundResultsScreen(leaderboardVisibility),
          answer_phase: 'closed',
          current_content_screen_key: null,
        })
        go('end-of-round')
        return
      }

      if (nextItem.kind === 'content') {
        await updateLiveGame({
          current_screen: 'content-screen',
          answer_phase: 'closed',
          current_content_screen_key: nextItem.content.screen_key,
        })
        setContentScreen(nextItem.content)
        return
      }
      if (nextItem.kind === 'show-game') {
        await openShowGame(nextItem.showGame)
        return
      }

      await updateLiveGame({
        current_screen: nextItem.question.question_type,
        answer_phase: 'open',
        answer_editing_allowed: false,
        question_stage: 'core',
        current_question_key: nextItem.question.question_key,
        current_content_screen_key: null,
      })
      setQuestion(nextItem.question)
      setContentScreen(null)
      setPhase('open')
      setQuestionStage('core')
      setGameScreen(nextItem.question.question_type)
      setSubmissions([])
      setBonusSubmissions([])
    } catch (error) {
      console.error('Could not advance the content screen:', error)
      setLiveError('Could not advance the game. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleAdvanceShowGame() {
    if (!showGame || actionBusy || showGame.status !== 'exploded') return
    setActionBusy(true)
    setLiveError(null)
    try {
      const nextItem = liveSequenceItems(allQuestions, allContentScreens, allShowGames)
        .find(item => item.itemPosition > showGame.item_position) ?? null

      if (!nextItem) {
        if (!liveGameId) throw new Error('The live game could not be found.')
        await finalizeLiveGame(liveGameId)
        go('final-results')
        return
      }
      if (nextItem.roundNumber !== showGame.round_number) {
        await updateLiveGame({
          current_screen: roundResultsScreen(leaderboardVisibility),
          answer_phase: 'closed',
          current_show_game_key: null,
        })
        go('end-of-round')
        return
      }
      if (nextItem.kind === 'content') {
        await updateLiveGame({ current_screen: 'content-screen', current_content_screen_key: nextItem.content.screen_key, current_show_game_key: null })
        setContentScreen(nextItem.content)
        setShowGame(null)
        setGameScreen('content-screen')
        return
      }
      if (nextItem.kind === 'show-game') {
        await openShowGame(nextItem.showGame)
        return
      }
      await updateLiveGame({
        current_screen: nextItem.question.question_type,
        answer_phase: 'open',
        answer_editing_allowed: false,
        question_stage: 'core',
        current_question_key: nextItem.question.question_key,
        current_content_screen_key: null,
        current_show_game_key: null,
      })
      setQuestion(nextItem.question)
      setShowGame(null)
      setPhase('open')
      setQuestionStage('core')
      setGameScreen(nextItem.question.question_type)
      setSubmissions([])
      setBonusSubmissions([])
    } catch (error) {
      console.error('Could not advance the show game:', error)
      setLiveError('Could not advance the game. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  const submissionByTeam = new Map<string, LiveSubmission>(submissions.map(submission => [submission.team_id, submission] as const))
  const activeBonus = runtimeBonusFromJson(question?.bonus)
  const bonusSubmissionByTeam = new Map<string, LiveBonusSubmission>(bonusSubmissions.map(submission => [submission.team_id, submission] as const))
  const answerRows = teams
    .map((team, originalIndex) => {
      const submission = submissionByTeam.get(team.id) ?? null
      return {
        team,
        submission,
        grading: submission && question ? storedSubmissionGrading(question, submission) : null,
        originalIndex,
      }
    })
    .sort((a, b) => {
      const aNeedsReview = a.grading?.items.some(item => item.status === 'review') ?? false
      const bNeedsReview = b.grading?.items.some(item => item.status === 'review') ?? false

      const aPriority = aNeedsReview ? 0 : a.submission ? 1 : 2
      const bPriority = bNeedsReview ? 0 : b.submission ? 1 : 2

      return aPriority - bPriority || a.originalIndex - b.originalIndex
    })
  const answeredCount = answerRows.filter(row => row.submission).length
  const coreReviewCount = answerRows.reduce(
    (total, row) => total + (row.grading?.items.filter(item => item.status === 'review').length ?? 0),
    0,
  )
  const bonusAnswerRows = teams.map(team => {
    const submission = bonusSubmissionByTeam.get(team.id) ?? null
    return {
      team,
      submission,
      grading: submission && activeBonus ? storedBonusGrading(activeBonus, submission) : null,
    }
  })
  const bonusAnsweredCount = bonusAnswerRows.filter(row => row.submission).length
  const bonusReviewCount = bonusAnswerRows.reduce(
    (total, row) => total + (row.grading?.items.filter(item => item.status === 'review').length ?? 0),
    0,
  )
  const reviewCount = coreReviewCount + bonusReviewCount
  const allActivePlayersLocked = phase === 'open' && teams.length > 0 && (
    questionStage === 'bonus'
      ? bonusAnsweredCount >= teams.length
      : answeredCount >= teams.length
  )
  const coreCorrectness = correctnessSummary(teams.length, submissions)
  const bonusCorrectness = correctnessSummary(teams.length, bonusSubmissions)
  const leaderboard = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const leaderboardPlacements = competitionPlacements(leaderboard)
  const totalRounds = Math.max(1, ...allQuestions.map(item => item.round_number))
  const sequenceItems = liveSequenceItems(allQuestions, allContentScreens, allShowGames)
  const firstRoundItem = question
    ? sequenceItems.find(item => item.roundNumber === question.round_number) ?? null
    : null
  const nextLiveItem = question ? sequenceItems.find(item => item.itemPosition > question.item_position) ?? null : null
  const nextIsNewRound = !!question && !!nextLiveItem && nextLiveItem.roundNumber !== question.round_number
  const isFinalQuestion = !!question && !nextLiveItem
  const correctDisplay = correctAnswerDisplay(question)
  const activeShowGameReward = showGameRewardFromSettings(showGame?.settings)
  const questionDetails = hostQuestionDetails(question)
  const showBonusInAnswers = Boolean(activeBonus && (questionStage === 'bonus' || phase !== 'open'))
  const compoundQuestion = question?.question_type === 'multi-answer'
    || question?.question_type === 'multi-part'
    || question?.question_type === 'ranking'

  const autoRunTimer = (() => {
    if (gameScreen === 'round-start') return { key: `round-${question?.round_number ?? 0}`, seconds: 5, label: 'First question opens in' }
    if (gameScreen === 'content-screen') return { key: `content-${contentScreen?.screen_key ?? ''}`, seconds: AUTO_RUN_CONTENT_SECONDS, label: 'Content advances in' }
    if (gameScreen === 'question-results') return { key: `leaderboard-${question?.question_key ?? ''}`, seconds: 10, label: 'Next question opens in' }
    if (phase === 'open') {
      const bonus = runtimeBonusFromJson(question?.bonus)
      const seconds = questionStage === 'bonus' && bonus
        ? 30 + ((Math.max(1, bonus.points) - 1) * 15)
        : autoRunAnswerSeconds(question ?? {})
      return { key: `open-${question?.question_key ?? ''}-${questionStage}`, seconds, label: 'Answers close in' }
    }
    if (phase === 'closed') return { key: `closed-${question?.question_key ?? ''}-${questionStage}`, seconds: 1, label: 'Scoring answers' }
    const revealSeconds = Math.min(10, autoRunRevealSeconds(question ?? {}) + (activeBonus ? 2 : 0))
    return { key: `reveal-${question?.question_key ?? ''}`, seconds: revealSeconds, label: 'Next question opens in' }
  })()

  async function publishAutoRunClock(remaining: number, paused = false) {
    if (!liveGameId || autoRunMode !== 'round') return
    const safeRemaining = Math.max(0, Math.trunc(remaining))
    const autoRunClock: Json = safeRemaining > 0
      ? {
          key: autoRunTimer.key,
          label: autoRunTimer.label,
          deadline_ms: paused ? null : Date.now() + (safeRemaining * 1000),
          paused_remaining: paused ? safeRemaining : null,
        }
      : null
    const settings: Record<string, Json> = { ...liveGameSettingsRef.current, auto_run_clock: autoRunClock }
    liveGameSettingsRef.current = settings
    const { error } = await supabase.from('games').update({ settings }).eq('id', liveGameId)
    if (error) console.error('Could not publish Auto-Run clock:', error)
  }

  useEffect(() => {
    autoRunActionRef.current = () => {
      if (actionBusy) return
      if (gameScreen === 'round-start') { void handleOpenQuestion(); return }
      if (gameScreen === 'content-screen') { void handleAdvanceContentScreen(); return }
      if (gameScreen === 'question-results') { void handleAdvance(); return }
      if (phase === 'open') { void handleCloseAnswers(); return }
      if (phase === 'closed' && activeBonus && questionStage === 'core') { void handleShowBonus(); return }
      if (phase === 'closed') { void handleAutoRunReveal(); return }
      void handleAdvance()
    }
  })

  useEffect(() => {
    // A persisted live-state transition starts a fresh countdown for that state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoRunRemaining(autoRunTimer.seconds)
  }, [autoRunTimer.key, autoRunTimer.seconds])

  useEffect(() => {
    if (autoRunMode !== 'round' || !autoRunOperating || !liveGameId || autoRunPublishedKeyRef.current === autoRunTimer.key) return
    autoRunPublishedKeyRef.current = autoRunTimer.key
    void publishAutoRunClock(autoRunTimer.seconds, autoRunPaused)
    // The state key deliberately controls publication; the deadline is not rewritten each second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunMode, autoRunOperating, autoRunPaused, autoRunTimer.key, autoRunTimer.seconds, liveGameId])

  useEffect(() => {
    if (autoRunMode !== 'round' || !autoRunOperating || autoRunPaused || actionBusy || autoRunRemaining <= 0) return
    const timer = window.setTimeout(() => {
      setAutoRunRemaining(current => {
        if (current <= 1) {
          window.setTimeout(() => autoRunActionRef.current(), 0)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [actionBusy, autoRunMode, autoRunOperating, autoRunPaused, autoRunRemaining, autoRunTimer.key])

  useEffect(() => {
    if (autoRunMode !== 'round' || !autoRunOperating || !allActivePlayersLocked) return
    // Submission Realtime events shorten, but never lengthen, the live countdown.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoRunRemaining(current => {
      const next = autoRunRemainingAfterAllLocked(current, true)
      if (next !== current) void publishAutoRunClock(next, autoRunPaused)
      return next
    })
    // The clock publisher is intentionally keyed by the observable lock state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allActivePlayersLocked, autoRunMode, autoRunOperating])

  const autoRunClockTone = autoRunClockColor(autoRunRemaining)
  const autoRunControls = autoRunMode === 'round' ? (
    <section style={{ background: C.livePanel, borderBottom: `1px solid ${C.liveLine}` }} className="sticky top-[52px] z-30 flex flex-wrap items-center justify-center gap-3 px-5 py-2.5 shadow-lg">
      <span style={{ color: autoRunOperating && !autoRunPaused ? '#C4B5FD' : C.caution }} className="text-xs font-black uppercase tracking-wider">
        {autoRunOperating ? autoRunPaused ? 'Auto-Run paused' : 'Auto-Run on' : 'Manual control'}
      </span>
      <span style={{ color: autoRunClockTone }} className="min-w-40 text-sm font-black tabular-nums transition-colors">
        {autoRunTimer.label}: {autoRunClockLabel(autoRunRemaining)}
      </span>
      <button type="button" onClick={() => setAutoRunRemaining(value => {
        const next = value + AUTO_RUN_EXTENSION_SECONDS
        if (autoRunOperating) void publishAutoRunClock(next, autoRunPaused)
        return next
      })} style={{ border: `1px solid ${C.liveLine}`, color: C.liveText }} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-white/5">+15 sec</button>
      {autoRunOperating && (
        <button type="button" onClick={() => setAutoRunPaused(value => {
          const next = !value
          void publishAutoRunClock(autoRunRemaining, next)
          return next
        })} style={{ border: `1px solid ${C.liveLine}`, color: C.liveText }} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-white/5">
          {autoRunPaused ? 'Resume' : 'Pause'}
        </button>
      )}
      {phase === 'open' && gameScreen !== 'round-start' && (
        <button type="button" onClick={() => { setAutoRunPaused(true); void handleCloseAnswers() }} style={{ border: `1px solid ${C.caution}`, color: C.caution }} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-white/5">Close now</button>
      )}
      <button type="button" onClick={() => {
        if (autoRunOperating) {
          setAutoRunOperating(false)
          setAutoRunPaused(false)
          autoRunPublishedKeyRef.current = ''
          void publishAutoRunClock(0)
        } else {
          setAutoRunOperating(true)
          setAutoRunPaused(false)
          autoRunPublishedKeyRef.current = autoRunTimer.key
          void publishAutoRunClock(autoRunRemaining)
        }
      }} style={{ border: `1px solid ${C.violet}`, color: '#C4B5FD' }} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-white/5">
        {autoRunOperating ? 'Take manual control' : 'Resume Auto-Run'}
      </button>
    </section>
  ) : null

  if (gameScreen === 'show-game') {
    const winner = teams.find(team => team.id === showGame?.winner_team_id) ?? null
    const pressedTeamIds = new Set(showGamePresses.map(press => press.team_id))
    const startedAt = showGame?.started_at ? new Date(showGame.started_at).getTime() : showGameNow
    const explodeAt = showGame?.explode_at ? new Date(showGame.explode_at).getTime() : showGameNow
    const fuseProgress = showGame?.status === 'exploded' ? 0 : Math.max(0, Math.min(100, ((explodeAt - showGameNow) / Math.max(1, explodeAt - startedAt)) * 100))
    return (
      <div style={{ background: C.liveBg, color: C.liveText }} className="min-h-[100dvh] flex flex-col">
        <header style={{ background: C.liveSurface, borderBottom: `1px solid ${C.liveLine}`, height: 52 }} className="sticky top-0 z-40 flex items-center gap-4 px-6">
          <BrandWordmark dark compact className="text-sm" />
          <div className="flex-1 text-center text-sm font-semibold" style={{ color: C.liveDim }}>Round {showGame?.round_number ?? 1} · Game</div>
          <JoinCodeButton dark /><CancelGameButton go={go} dark />
          <span style={{ background: C.violet }} className="rounded-full px-3 py-1 text-xs font-bold">GAME LIVE</span>
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <section style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="w-full max-w-4xl rounded-3xl p-8 text-center shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Beat the Bomb</p>
            <h1 className="mt-2 text-5xl font-black">{showGame?.title ?? 'Beat the Bomb'}</h1>
            <p style={{ color: C.liveDim }} className="mx-auto mt-4 max-w-xl text-lg font-semibold">
              {showGameRewardDescription(activeShowGameReward)}
            </p>
            <div className={`mt-7 text-9xl ${showGame?.status === 'open' ? 'animate-pulse' : ''}`} aria-label={showGame?.status === 'exploded' ? 'Exploded bomb' : 'Bomb with a burning fuse'}>{showGame?.status === 'exploded' ? '💥' : '💣'}</div>
            <div style={{ background: C.liveLine }} className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full">
              <div style={{ width: `${fuseProgress}%`, background: showGame?.status === 'exploded' ? C.stop : C.caution }} className="h-full rounded-full transition-[width] duration-100" />
            </div>
            {showGame?.status === 'exploded' ? (
              <div className="mt-7">
                <p className="text-sm font-bold uppercase tracking-widest text-violet-300">Winner</p>
                <p className="mt-2 text-4xl font-black text-emerald-400">{winner?.name ?? '—'}</p>
              </div>
            ) : (
              <p style={{ color: C.liveDim }} className="mt-6 text-lg">Fuse burning… {showGamePresses.length} of {teams.length} teams have pressed.</p>
            )}
            <div className="mx-auto mt-7 grid max-w-2xl gap-2 sm:grid-cols-2">
              {teams.map(team => <div key={team.id} style={{ border: `1px solid ${C.liveLine}`, background: C.livePanel }} className="flex items-center justify-between rounded-xl px-4 py-3 text-left"><span className="font-bold">{team.name}</span><span className={pressedTeamIds.has(team.id) ? 'text-emerald-400' : 'text-zinc-500'}>{pressedTeamIds.has(team.id) ? 'Pressed ✓' : 'Waiting…'}</span></div>)}
            </div>
            {liveError && <p style={{ color: C.stop }} className="mt-5 text-sm font-semibold">{liveError}</p>}
            <button data-host-navigation="forward" onClick={handleAdvanceShowGame} disabled={actionBusy || showGame?.status !== 'exploded'} style={{ background: C.violet }} className="mx-auto mt-8 rounded-2xl px-10 py-5 text-xl font-extrabold text-white disabled:opacity-35">
              {showGame?.status === 'exploded' ? 'Continue →' : 'Waiting for the bomb…'}
            </button>
          </section>
        </main>
      </div>
    )
  }

  if (gameScreen === 'content-screen') {
    const nextContentItem = contentScreen
      ? sequenceItems.find(item => item.itemPosition > contentScreen.item_position) ?? null
      : null
    const contentButtonLabel = !nextContentItem
      ? 'Finish Game →'
      : nextContentItem.roundNumber !== contentScreen?.round_number
        ? 'End Round →'
        : nextContentItem.kind === 'content'
          ? 'Next Content Screen →'
          : nextContentItem.kind === 'show-game' ? 'Start Game →' : 'Open Next Question →'

    return (
      <div style={{ background: C.liveBg, color: C.liveText }} className="min-h-[100dvh] flex flex-col">
        <header style={{ background: C.liveSurface, borderBottom: `1px solid ${C.liveLine}`, height: 52 }} className="sticky top-0 z-40 flex items-center px-6 gap-4 shrink-0">
          <BrandWordmark dark compact className="text-sm" />
          <div className="flex-1 text-center text-sm font-semibold" style={{ color: C.liveDim }}>
            Round {contentScreen?.round_number ?? question?.round_number ?? 1} · {contentScreen?.round_title ?? question?.round_title ?? 'Content Screen'}
          </div>
          <JoinCodeButton dark />
          <CancelGameButton go={go} dark />
          <span style={{ background: C.violet }} className="rounded-full px-3 py-1 text-xs font-bold">CONTENT SCREEN LIVE</span>
        </header>
        {autoRunControls}

        <main className="flex flex-1 items-center justify-center px-8 py-10">
          <section style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="w-full max-w-4xl rounded-3xl p-8 text-center shadow-2xl">
            <p style={{ color: '#C4B5FD' }} className="mb-4 text-xs font-bold uppercase tracking-[0.2em]">Shown on every player screen</p>
            {contentScreen?.image_url && (
              <div role="img" aria-label="Live content screen image" className="mx-auto mb-7 h-64 max-w-2xl rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url(${contentScreen.image_url})` }} />
            )}
            <h1 className="text-5xl font-black leading-tight">{contentScreen?.title ?? 'Loading content screen…'}</h1>
            {contentScreen?.body && <p style={{ color: C.liveDim }} className="mx-auto mt-6 max-w-2xl text-xl leading-8">{contentScreen.body}</p>}
            {liveError && <p style={{ color: C.stop }} className="mt-5 text-sm font-semibold">{liveError}</p>}
            <div className="mx-auto mt-10 grid max-w-xl grid-cols-[160px_minmax(0,1fr)] gap-3">
              <button
                data-host-navigation="back"
                disabled
                style={{ border: `1px solid ${C.liveLine}`, color: C.liveText }}
                className="rounded-2xl px-5 py-5 text-sm font-bold opacity-35 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <button data-host-navigation="forward" onClick={handleAdvanceContentScreen} disabled={actionBusy || !contentScreen} style={{ background: C.violet, boxShadow: `0 8px 32px ${C.violet}60` }} className="rounded-2xl px-8 py-5 text-xl font-extrabold text-white hover:opacity-90 disabled:opacity-50">
                {actionBusy ? 'Advancing…' : contentButtonLabel}
              </button>
            </div>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div style={{ background: C.liveBg, color: C.liveText }} className="min-h-[100dvh] flex flex-col">
      <header style={{ background: C.liveSurface, borderBottom: `1px solid ${C.liveLine}`, height: 52 }}
        className="flex items-center px-6 gap-4 shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-2 shrink-0">
          <BrandWordmark dark compact className="text-sm" />
        </div>
        <div className="flex-1 flex items-center justify-center gap-4 text-sm">
          {gameScreen === 'round-start' ? (
            <>
              <span style={{ color: C.liveDim }}>Round {question?.round_number ?? 1} of {totalRounds}</span>
              <span style={{ color: C.liveLine }}>·</span>
              <span style={{ color: C.liveDim }}>{question?.round_title ?? 'Friday Night Trivia'}</span>
            </>
          ) : (
            <>
              <span style={{ color: C.liveDim }}>Round {question?.round_number ?? 1} of {totalRounds}</span>
              <span style={{ color: C.liveLine }}>·</span>
              <span style={{ color: C.liveText }} className="font-bold">
                Question {question?.round_position ?? 1} of {question?.round_question_count ?? 1}
              </span>
              <span style={{ color: C.liveLine }}>·</span>
              <span style={{ color: C.liveDim }}>{question?.round_title ?? 'Friday Night Trivia'}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <JoinCodeButton dark />
          <div className="relative">
            <button onClick={() => setEmergency(e => !e)}
              style={{ border: `1px solid ${C.liveLine}`, color: C.liveDim }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:border-caution hover:text-caution transition-colors">
              Controls
            </button>
            {emergency && (
              <div style={{ background: C.livePanel, border: `1px solid ${C.liveLine}`, right: 0, top: '100%', marginTop: 6, width: 240, zIndex: 50 }}
                className="absolute rounded-xl shadow-2xl p-2 space-y-0.5">
                <div className="pt-1">
                  <p style={{ color: C.liveDim }} className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest">Leave this session</p>
                  <button
                    onClick={() => exitHostSession(go)}
                    style={{ color: C.liveText }}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-live-surface hover:text-white transition-colors text-left"
                  >
                    <span className="block">Exit to My Quizzes</span>
                    <span style={{ color: C.liveDim }} className="mt-0.5 block text-[10px] font-medium">Game keeps running</span>
                  </button>
                  <CancelGameButton go={go} dark className="w-full" description="Ends the game for everyone" />
                </div>
              </div>
            )}
          </div>
          <span style={{ background: '#DC2626' }} className="w-2 h-2 rounded-full animate-pulse" />
          <span style={{ color: C.liveDim }} className="text-xs font-semibold">LIVE</span>
        </div>
      </header>
      {autoRunControls}

      <div className="flex flex-1 items-start min-h-0">
        <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-5 px-5 py-5 pb-12 min-w-0 lg:px-7 lg:py-6">
          {gameScreen === 'round-start' ? (
            <>
              <section
                style={{ background: C.liveSurface, border: `1.5px solid ${C.caution}55` }}
                className="rounded-3xl px-8 py-10 text-center shadow-2xl shrink-0"
              >
                <p style={{ color: C.caution }} className="mb-8 text-[11px] font-extrabold uppercase tracking-[0.2em]">
                  On player screens
                </p>
                <p style={{ color: C.liveDim }} className="mb-5 text-xs font-bold uppercase tracking-[0.14em]">Starting now</p>
                <p style={{ color: '#C4B5FD' }} className="mb-2 text-sm font-semibold">Round {question?.round_number ?? 1}</p>
                <h1 style={{ color: C.liveText }} className="text-5xl font-black leading-tight">{question?.round_title ?? 'Loading round…'}</h1>
                <p style={{ color: C.liveDim }} className="mt-3 text-base">{question?.round_question_count ?? 0} questions</p>
              </section>

              <section
                style={{ background: `${C.liveSurface}B8`, border: `1px solid ${C.liveLine}` }}
                className="rounded-2xl px-5 py-4 shrink-0"
              >
                <div className="flex items-start gap-5">
                  <div className="min-w-0 flex-1">
                    <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest">Host only · Up next</p>
                    <p style={{ color: C.liveText }} className="mt-2 text-lg font-bold leading-snug">
                      {firstRoundItem?.kind === 'show-game'
                        ? `Game: ${firstRoundItem.showGame.title}`
                        : firstRoundItem?.kind === 'content'
                          ? `Content: ${firstRoundItem.content.title}`
                          : `Q${question?.round_position ?? 1}: ${question?.prompt ?? 'Loading question…'}`}
                    </p>
                  </div>
                  {firstRoundItem?.kind === 'show-game' ? (
                    <div className="max-w-sm shrink-0 text-right">
                      <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest">Reward</p>
                      <p style={{ color: '#C4B5FD' }} className="mt-1 text-sm font-extrabold">{showGameRewardDescription(showGameRewardFromSettings(firstRoundItem.showGame.settings))}</p>
                    </div>
                  ) : firstRoundItem?.kind === 'question' ? (
                    <div className="max-w-xs shrink-0 text-right">
                      <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest">Correct answer</p>
                      <p style={{ color: '#C4B5FD' }} className="mt-1 text-sm font-extrabold">{correctDisplay}</p>
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          ) : gameScreen === 'question-results' ? (
            <section
              style={{ background: C.liveSurface, border: `1px solid ${C.violet}55` }}
              className="rounded-3xl px-8 py-8 shadow-2xl shrink-0"
            >
              <p style={{ color: '#C4B5FD' }} className="text-center text-[11px] font-extrabold uppercase tracking-[0.2em]">
                On player screens
              </p>
              <h1 style={{ color: C.liveText }} className="mt-3 text-center text-4xl font-black">Leaderboard</h1>
              <div className="mx-auto mt-6 max-w-xl space-y-2">
                {leaderboard.slice(0, 3).map((team, index) => (
                  <div
                    key={team.id}
                    style={{ background: leaderboardPlacements[index] === 1 ? `${C.violet}25` : C.livePanel, border: `1px solid ${leaderboardPlacements[index] === 1 ? `${C.violet}55` : C.liveLine}` }}
                    className="flex items-center gap-4 rounded-2xl px-5 py-3"
                  >
                    <span style={{ background: leaderboardPlacements[index] === 1 ? C.violet : C.liveLine, color: leaderboardPlacements[index] === 1 ? 'white' : C.liveDim }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold">
                      {leaderboardPlacements[index]}
                    </span>
                    <span style={{ color: C.liveText }} className="min-w-0 flex-1 truncate font-bold">{team.name}</span>
                    <span style={{ color: C.liveText }} className="font-extrabold tabular-nums">{team.score}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : (
          <div style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="shrink-0 rounded-2xl p-4 lg:p-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p style={{ color: '#C4B5FD' }} className="text-[11px] font-extrabold uppercase tracking-[0.18em]">
                On player screens
              </p>
              <p style={{ color: C.liveDim }} className="text-[11px] font-bold uppercase tracking-widest">
                {(question?.category ?? 'General')} · {question?.difficulty ?? '—'} · {question?.points_max ?? 1} pts max
              </p>
            </div>

            {question?.image_url && (
              <div style={{ background: '#fff', borderRadius: 16 }} className="h-36 mb-5 flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- Host-authored URLs cannot use a fixed remote-image allowlist. */}
                <img src={question.image_url} alt="Question image" className="max-h-28 max-w-[80%] object-contain" />
              </div>
            )}

            <p style={{ color: C.liveText }} className="mb-4 text-xl font-extrabold leading-snug xl:text-2xl">
              {question?.prompt ?? 'Loading question…'}
            </p>

            {questionDetails.length > 0 && question?.question_type !== 'multi-part' && (
              <div
                style={{ background: `${C.livePanel}B8`, border: `1px solid ${C.liveLine}` }}
                className="rounded-xl px-4 py-3.5 mb-5"
              >
                <p
                  style={{ color: C.liveDim }}
                  className="text-[10px] font-bold uppercase tracking-widest mb-2.5"
                >
                  {question?.question_type === 'ranking'
                    ? 'Items to rank'
                    : question?.question_type === 'multiple-choice'
                      ? 'Answer options'
                      : 'Question parts'}
                </p>

                <div className="space-y-2">
                  {questionDetails.map((detail) => (
                    <div key={`${detail.label}-${detail.text}`} className="flex items-start gap-3">
                      <span
                        style={{
                          background: `${C.violet}25`,
                          color: '#C4B5FD',
                          border: `1px solid ${C.violet}35`,
                        }}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-extrabold shrink-0"
                      >
                        {detail.label}
                      </span>
                      <span style={{ color: C.liveText }} className="text-sm font-semibold leading-relaxed pt-0.5">
                        {detail.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase !== 'revealed' ? (
              <div style={{ background: `${C.violet}12`, border: `1px dashed ${C.violet}50` }}
                className="flex items-center gap-3 rounded-xl px-4 py-3 mb-3">
                <div className="flex-1 min-w-0">
                  <p style={{ color: C.liveViolet }} className="text-[10px] font-bold uppercase tracking-widest">
                    {question?.question_type === 'multi-part' ? 'Question parts + answers · Host only' : 'Correct Answer · Host only'}
                  </p>
                  {question?.question_type === 'multi-part' ? (
                    <div className="mt-2 max-w-4xl space-y-2.5">
                      {questionDetails.map((detail, index) => {
                        const answer = asStringArray(question.correct_answer)[index] ?? ''
                        return (
                          <div
                            key={`${detail.label}-${detail.text}`}
                            className="grid items-start gap-3"
                            style={{ gridTemplateColumns: '26px minmax(0, 3fr) minmax(140px, 2fr)' }}
                          >
                            <span
                              style={{
                                background: `${C.violet}25`,
                                color: '#C4B5FD',
                                border: `1px solid ${C.violet}35`,
                              }}
                              className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-extrabold shrink-0"
                            >
                              {detail.label}
                            </span>

                            <span style={{ color: C.liveText }} className="text-sm font-semibold leading-relaxed pt-0.5">
                              {detail.text}
                            </span>

                            <span style={{ color: C.liveViolet }} className="text-left text-sm font-extrabold break-words pt-0.5">
                              → {answer}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ) : question?.question_type === 'multi-answer' ? (
                    <div className="mt-1 space-y-1">
                      {asStringArray(question.correct_answer).map((answer) => (
                        <p key={answer} style={{ color: C.liveViolet }} className="text-lg font-extrabold">
                          {answer}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: C.liveViolet }} className="text-lg font-extrabold mt-0.5">{correctDisplay}</p>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ background: `${C.go}20`, border: `1.5px solid ${C.go}60` }}
                className="flex items-center gap-3 rounded-xl px-4 py-3 mb-3">
                <div className="flex-1 min-w-0">
                  <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest">
                    {question?.question_type === 'multi-part' ? 'Question parts + answers · Revealed to players' : 'Correct Answer · Revealed to players'}
                  </p>
                  {question?.question_type === 'multi-part' ? (
                    <div className="mt-2 max-w-4xl space-y-2.5">
                      {questionDetails.map((detail, index) => {
                        const answer = asStringArray(question.correct_answer)[index] ?? ''
                        return (
                          <div
                            key={`${detail.label}-${detail.text}`}
                            className="grid items-start gap-3"
                            style={{ gridTemplateColumns: '26px minmax(0, 3fr) minmax(140px, 2fr)' }}
                          >
                            <span
                              style={{
                                background: `${C.violet}25`,
                                color: '#C4B5FD',
                                border: `1px solid ${C.violet}35`,
                              }}
                              className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-extrabold shrink-0"
                            >
                              {detail.label}
                            </span>

                            <span style={{ color: C.liveText }} className="text-sm font-semibold leading-relaxed pt-0.5">
                              {detail.text}
                            </span>

                            <span style={{ color: C.go }} className="text-left text-sm font-extrabold break-words pt-0.5">
                              → {answer}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ) : question?.question_type === 'multi-answer' ? (
                    <div className="mt-1 space-y-1">
                      {asStringArray(question.correct_answer).map((answer) => (
                        <p key={answer} style={{ color: C.go }} className="text-xl font-extrabold">
                          {answer}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: C.go }} className="text-xl font-extrabold mt-0.5">{correctDisplay}</p>
                  )}
                </div>
              </div>
            )}

            {question?.notes && (
              <div style={{ background: `${C.violet}10`, border: `1px dashed ${C.violet}40` }} className="rounded-xl p-3.5">
                <p style={{ color: `${C.violet}80` }} className="text-[10px] font-bold uppercase tracking-widest mb-1">Notes · Host only</p>
                <p style={{ color: `${C.liveText}99` }} className="text-sm leading-relaxed">{question.notes}</p>
              </div>
            )}

            {activeBonus && (
              <div
                style={{
                  background: questionStage === 'bonus' || phase === 'revealed' ? `${C.violet}16` : `${C.livePanel}B8`,
                  border: `1px solid ${questionStage === 'bonus' || phase === 'revealed' ? `${C.violet}55` : C.liveLine}`,
                }}
                className="mt-4 rounded-xl p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <p style={{ color: '#C4B5FD' }} className="text-[10px] font-extrabold uppercase tracking-widest">
                    Bonus · {activeBonus.points} {activeBonus.points === 1 ? 'point' : 'points'}
                  </p>
                  <span style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest">
                    {questionStage === 'core' && phase !== 'revealed' ? 'Host only · Up next' : 'Shown to players'}
                  </span>
                </div>
                <p style={{ color: C.liveText }} className="mt-2 text-lg font-extrabold">{activeBonus.prompt}</p>
                <p style={{ color: phase === 'revealed' ? C.go : '#C4B5FD' }} className="mt-2 text-sm font-bold">
                  Answer: {activeBonus.correctAnswer}
                </p>
              </div>
            )}
          </div>
          )}

          {liveError && (
            <div style={{ background: `${C.stop}18`, border: `1px solid ${C.stop}45`, color: '#FCA5A5' }} className="rounded-xl px-4 py-3 text-sm font-semibold">
              {liveError}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 shrink-0">
            <div className="flex min-w-0 items-center gap-3">
              <h3 style={{ color: C.liveText }} className="shrink-0 font-bold text-sm">Team Answers</h3>
              <span
                style={{
                  background: gameScreen === 'question-results'
                    ? `${C.violet}20`
                    : gameScreen === 'round-start' || phase === 'closed'
                      ? `${C.caution}20`
                      : phase === 'open' ? `${C.violet}20` : `${C.go}20`,
                  border: `1px solid ${gameScreen === 'question-results'
                    ? `${C.violet}45`
                    : gameScreen === 'round-start' || phase === 'closed'
                      ? `${C.caution}45`
                      : phase === 'open' ? `${C.violet}45` : `${C.go}45`}`,
                  color: gameScreen === 'question-results'
                    ? '#C4B5FD'
                    : gameScreen === 'round-start' || phase === 'closed'
                      ? C.caution
                      : phase === 'open' ? '#C4B5FD' : C.go,
                }}
                className="truncate rounded-lg px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide"
              >
                {gameScreen === 'question-results'
                  ? 'Leaderboard shown'
                  : gameScreen === 'round-start'
                    ? 'Waiting to start'
                  : phase === 'open'
                    ? `${questionStage === 'bonus' ? 'Accepting bonus answers' : 'Accepting answers'} · ${questionStage === 'bonus' ? bonusAnsweredCount : answeredCount}/${teams.length}`
                    : phase === 'closed'
                      ? `Answers closed · ${answeredCount}/${teams.length}`
                      : 'Answer revealed'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {phase === 'revealed' && autoRunMode === 'off' && teams.length > 0 && (
                <div className="flex items-center gap-2">
                  <span
                    style={{ background: `${C.go}20`, color: C.go, border: `1px solid ${C.go}45` }}
                    className="rounded-xl px-5 py-3 text-center tabular-nums shadow-lg"
                  >
                    <strong className="block text-2xl font-black leading-none">{coreCorrectness.percentage}%</strong>
                    <span className="mt-1 block text-[11px] font-extrabold uppercase tracking-wide">{coreCorrectness.correct} of {coreCorrectness.total} teams correct</span>
                  </span>
                  {activeBonus && (
                    <span
                      style={{ background: `${C.violet}20`, color: '#C4B5FD', border: `1px solid ${C.violet}45` }}
                      className="rounded-xl px-4 py-3 text-center tabular-nums"
                    >
                      <strong className="block text-xl font-black leading-none">{bonusCorrectness.percentage}%</strong>
                      <span className="mt-1 block text-[10px] font-extrabold uppercase tracking-wide">Bonus · {bonusCorrectness.correct} of {bonusCorrectness.total}</span>
                    </span>
                  )}
                </div>
              )}
              {reviewCount > 0 && (
                <span
                  style={{ background: `${C.caution}25`, color: C.caution, border: `1px solid ${C.caution}45` }}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold"
                >
                  {reviewCount} need{reviewCount === 1 ? 's' : ''} review
                </span>
              )}
            </div>
          </div>


  <div style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="rounded-2xl overflow-hidden shrink-0">
    {!compoundQuestion ? (
      <>
        <div
          style={{
            background: C.livePanel,
            borderBottom: `1px solid ${C.liveLine}`,
            color: C.liveDim,
            display: 'grid',
            gridTemplateColumns: '1.1fr 1.5fr 150px',
          }}
          className="text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 gap-4"
        >
          <span>Team</span>
          <span>{showBonusInAnswers ? 'Their answers' : 'Their answer'}</span>
          <span className="text-right">Status</span>
        </div>

        {answerRows.map(({ team, submission, grading }) => {
          const waiting = !submission
          const item = grading?.items[0] ?? null
          const bonusRow = bonusAnswerRows.find(row => row.team.id === team.id) ?? null
          const bonusItem = bonusRow?.grading?.items[0] ?? null
          const needsReview = item?.status === 'review' || (showBonusInAnswers && bonusItem?.status === 'review')
          const submittedIsCorrect = item?.status === 'correct' || submission?.is_correct === true

          return (
            <div
              key={team.id}
              style={{
                borderBottom: `1px solid ${needsReview ? `${C.caution}45` : C.liveLine}`,
                background: needsReview ? `${C.caution}12` : 'transparent',
                display: 'grid',
                gridTemplateColumns: '1.1fr 1.5fr 150px',
              }}
              className="items-center px-4 py-3 gap-4 last:border-0"
            >
              <span
                style={{ color: waiting && !bonusRow?.submission ? `${C.liveText}45` : needsReview ? C.liveText : `${C.liveText}85` }}
                className={`text-sm truncate ${needsReview ? 'font-bold' : 'font-medium'}`}
              >
                {team.name}
              </span>

              <div className="min-w-0 space-y-2">
                <div className="flex min-h-9 min-w-0 items-center gap-2">
                  {showBonusInAnswers && <span style={{ color: C.liveDim }} className="w-12 shrink-0 text-[10px] font-extrabold uppercase">Main</span>}
                  <span
                    style={{ color: waiting ? C.liveDim : submittedIsCorrect ? C.go : `${C.liveText}85` }}
                    className={`truncate text-sm italic ${submittedIsCorrect ? 'font-extrabold' : 'font-semibold'}`}
                  >
                    {waiting ? 'Waiting…' : item?.submitted || submissionDisplay(question, submission.answer_text)}
                  </span>
                  {!waiting && item?.expected && item.status !== 'correct' && (
                    <>
                      <span style={{ color: `${C.liveText}35` }} className="shrink-0 text-xs">→</span>
                      <span style={{ color: C.go }} className="truncate text-xs font-bold" title={`Correct answer: ${item.expected}`}>{item.expected}</span>
                    </>
                  )}
                  {item?.status === 'review' && item.review_reason && (
                    <span style={{ color: C.caution }} className="shrink-0 text-[10px] font-bold" title={reviewReasonLabel(item.review_reason)}>{reviewReasonLabel(item.review_reason)}</span>
                  )}
                </div>
                {showBonusInAnswers && (
                  <div style={{ borderTop: `1px solid ${C.liveLine}` }} className="flex min-h-9 min-w-0 items-center gap-2 pt-2">
                    <span style={{ color: '#C4B5FD' }} className="w-12 shrink-0 text-[10px] font-extrabold uppercase">Bonus</span>
                    <span style={{ color: bonusItem?.status === 'correct' ? C.go : bonusRow?.submission ? `${C.liveText}85` : C.liveDim }} className="truncate text-sm italic font-semibold">
                      {bonusRow?.submission ? bonusItem?.submitted || bonusRow.submission.answer_text : 'Waiting…'}
                    </span>
                    {bonusItem?.expected && bonusItem.status !== 'correct' && (
                      <><span style={{ color: `${C.liveText}35` }} className="shrink-0 text-xs">→</span><span style={{ color: C.go }} className="truncate text-xs font-bold">{bonusItem.expected}</span></>
                    )}
                    {bonusItem?.status === 'review' && bonusItem.review_reason && (
                      <span style={{ color: C.caution }} className="shrink-0 text-[10px] font-bold" title={reviewReasonLabel(bonusItem.review_reason)}>{reviewReasonLabel(bonusItem.review_reason)}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex min-h-9 items-center justify-end">
                  {waiting || !item || !submission ? <span style={{ color: C.liveDim }} className="text-xs">—</span> : (
                    <ReviewBadge status={item.status} disabled={phase === 'revealed'} onCorrect={() => { void handleReviewItem(submission.id, 0, 'correct') }} onIncorrect={() => { void handleReviewItem(submission.id, 0, 'incorrect') }} />
                  )}
                </div>
                {showBonusInAnswers && (
                  <div style={{ borderTop: `1px solid ${C.liveLine}` }} className="flex min-h-9 items-center justify-end pt-2">
                    {bonusRow?.submission && bonusItem ? (
                      <ReviewBadge status={bonusItem.status} disabled={phase === 'revealed'} onCorrect={() => { void handleBonusReview(bonusRow.submission!.id, 'correct') }} onIncorrect={() => { void handleBonusReview(bonusRow.submission!.id, 'incorrect') }} />
                    ) : <span style={{ color: C.liveDim }} className="text-xs">—</span>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </>
    ) : (
      <>
        <div
          style={{
            background: C.livePanel,
            borderBottom: `1px solid ${C.liveLine}`,
            color: C.liveDim,
            display: 'grid',
            gridTemplateColumns: '1.05fr minmax(0, 2.2fr) 90px',
          }}
          className="text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 gap-4"
        >
          <span>Team</span>
          <span>{question?.question_type === 'ranking' ? 'Their order' : 'Their answers'}</span>
          <span className="text-right">Score</span>
        </div>

        {answerRows.map(({ team, submission, grading }) => {
          const waiting = !submission
          const items = grading?.items ?? []
          const bonusRow = bonusAnswerRows.find(row => row.team.id === team.id) ?? null
          const bonusItem = bonusRow?.grading?.items[0] ?? null
          const hasReview = items.some(item => item.status === 'review') || (showBonusInAnswers && bonusItem?.status === 'review')
          const score = (grading ? gradingPoints(grading, question?.points_max ?? 1) : 0)
            + (showBonusInAnswers && bonusRow?.grading ? gradingPoints(bonusRow.grading, activeBonus?.points ?? 1) : 0)
          const max = (question?.points_max ?? Math.max(1, items.length)) + (showBonusInAnswers ? activeBonus?.points ?? 1 : 0)

          return (
            <div
              key={team.id}
              style={{
                borderBottom: `1px solid ${hasReview ? `${C.caution}45` : C.liveLine}`,
                background: hasReview ? `${C.caution}12` : 'transparent',
                display: 'grid',
                gridTemplateColumns: '1.05fr minmax(0, 2.2fr) 90px',
                alignItems: 'start',
              }}
              className="px-4 py-3 gap-4 last:border-0"
            >
              <span
                style={{ color: waiting && !bonusRow?.submission ? `${C.liveText}45` : hasReview ? C.liveText : `${C.liveText}85` }}
                className={`text-sm truncate pt-1 ${hasReview ? 'font-bold' : 'font-medium'}`}
              >
                {team.name}
              </span>

              <div className="space-y-1.5 min-w-0">
                {waiting ? (
                  <span style={{ color: C.liveDim }} className="text-sm italic block pt-1">Waiting…</span>
                ) : (
                  items.map((item, itemIndex) => (
                    <div
                      key={`${submission?.id}-${itemIndex}`}
                      className="grid items-center gap-2"
                      style={{
                        gridTemplateColumns: question?.question_type === 'multi-answer'
                          ? 'minmax(0, 1fr) 120px'
                          : '24px minmax(0, 1fr) 120px',
                      }}
                    >
                      {question?.question_type !== 'multi-answer' && (
                        <span
                          style={{
                            background: question?.question_type === 'multi-part' ? C.violetPale : 'transparent',
                            color: question?.question_type === 'multi-part' ? C.violet : `${C.liveText}55`,
                          }}
                          className={`${question?.question_type === 'multi-part'
                            ? 'w-5 h-5 rounded-full flex items-center justify-center'
                            : 'text-right pr-1'} text-[10px] font-extrabold shrink-0`}
                        >
                          {item.label ?? itemIndex + 1}{question?.question_type === 'multi-part' ? '' : '.'}
                        </span>
                      )}

                      <div className="min-w-0 flex items-center gap-2">
                        <span
                          style={{
                            color: item.status === 'correct'
                              ? C.go
                              : `${C.liveText}85`,
                          }}
                          className="text-sm italic font-semibold truncate"
                          title={item.submitted || 'No answer'}
                        >
                          {item.submitted || '—'}
                        </span>

                        {question?.question_type !== 'multi-answer' && item.status !== 'correct' && item.expected && (
                          <>
                            <span style={{ color: `${C.liveText}35` }} className="text-xs shrink-0">→</span>
                            <span
                              style={{ color: C.go }}
                              className="text-xs font-bold truncate"
                              title={`Correct answer: ${item.expected}`}
                            >
                              {item.expected}
                            </span>
                          </>
                        )}

                        {question?.question_type === 'multi-answer' && item.status === 'review' && item.expected && (
                          <span
                            style={{ color: C.caution }}
                            className="text-xs font-bold truncate"
                            title={`Possible match: ${item.expected}`}
                          >
                            possible: {item.expected}
                          </span>
                        )}
                        {item.status === 'review' && item.review_reason && (
                          <span
                            style={{ color: C.caution }}
                            className="shrink-0 text-[10px] font-bold"
                            title={reviewReasonLabel(item.review_reason)}
                          >
                            {reviewReasonLabel(item.review_reason)}
                          </span>
                        )}
                      </div>

                      <div className="flex justify-end">
                        {submission ? (
                          <ReviewBadge
                            status={item.status}
                            disabled={phase === 'revealed'}
                            onCorrect={() => { void handleReviewItem(submission.id, itemIndex, 'correct') }}
                            onIncorrect={() => { void handleReviewItem(submission.id, itemIndex, 'incorrect') }}
                          />
                        ) : null}
                      </div>
                    </div>
                  ))
                )}

                {!waiting && question?.question_type === 'multi-answer' && grading && (grading.missing ?? []).length > 0 && (
                  <div
                    style={{ borderTop: `1px solid ${C.liveLine}` }}
                    className="mt-2 pt-2 flex items-start gap-2 text-xs"
                  >
                    <span style={{ color: C.liveDim }} className="font-bold uppercase tracking-wide shrink-0">Missing</span>
                    <div className="space-y-0.5">
                      {(grading.missing ?? []).map((answer) => (
                        <div key={answer} style={{ color: C.go }} className="font-bold">
                          {answer}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showBonusInAnswers && (
                  <div
                    style={{ borderTop: `1px solid ${C.liveLine}` }}
                    className="mt-2 grid items-center gap-2 pt-2"
                    aria-label="Bonus answer"
                  >
                    <div className="grid items-center gap-2" style={{ gridTemplateColumns: '52px minmax(0, 1fr) 120px' }}>
                      <span style={{ color: '#C4B5FD' }} className="text-[10px] font-extrabold uppercase">Bonus</span>
                      <div className="flex min-w-0 items-center gap-2">
                        <span style={{ color: bonusItem?.status === 'correct' ? C.go : bonusRow?.submission ? `${C.liveText}85` : C.liveDim }} className="truncate text-sm italic font-semibold">
                          {bonusRow?.submission ? bonusItem?.submitted || bonusRow.submission.answer_text : 'Waiting…'}
                        </span>
                        {bonusItem?.expected && bonusItem.status !== 'correct' && (
                          <><span style={{ color: `${C.liveText}35` }} className="shrink-0 text-xs">→</span><span style={{ color: C.go }} className="truncate text-xs font-bold">{bonusItem.expected}</span></>
                        )}
                        {bonusItem?.status === 'review' && bonusItem.review_reason && (
                          <span style={{ color: C.caution }} className="shrink-0 text-[10px] font-bold" title={reviewReasonLabel(bonusItem.review_reason)}>{reviewReasonLabel(bonusItem.review_reason)}</span>
                        )}
                      </div>
                      <div className="flex justify-end">
                        {bonusRow?.submission && bonusItem ? (
                          <ReviewBadge status={bonusItem.status} disabled={phase === 'revealed'} onCorrect={() => { void handleBonusReview(bonusRow.submission!.id, 'correct') }} onIncorrect={() => { void handleBonusReview(bonusRow.submission!.id, 'incorrect') }} />
                        ) : <span style={{ color: C.liveDim }} className="text-xs">—</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="text-right pt-1">
                {waiting && !bonusRow?.submission ? (
                  <span style={{ color: C.liveDim }} className="text-xs">—</span>
                ) : (
                  <span
                    style={{ color: score === max ? C.go : score === 0 ? C.stop : C.caution }}
                    className="text-sm font-extrabold tabular-nums"
                  >
                    {score}
                    <span style={{ color: C.liveDim }} className="text-[10px] font-normal"> / {max}</span>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </>
    )}

    {teams.length === 0 && (
      <div className="px-4 py-8 text-center">
        <p style={{ color: C.liveDim }} className="text-sm">No teams are in this game yet.</p>
      </div>
    )}
  </div>

</div>

        <div style={{ background: C.liveSurface, borderLeft: `1px solid ${C.liveLine}`, width: 300 }} className="flex flex-col shrink-0 sticky top-[52px] h-[calc(100dvh-52px)]">
          <div className="flex-1 p-5 overflow-y-auto">
            <p style={{ color: C.liveDim }} className="text-[11px] font-bold uppercase tracking-widest mb-3">Leaderboard</p>
            <div className="space-y-1">
              {leaderboard.map((team, i) => (
                <div key={team.id} style={{ background: leaderboardPlacements[i] === 1 ? `${C.violet}20` : 'transparent' }} className="flex items-center gap-3 p-2.5 rounded-xl">
                  <div style={{ background: leaderboardPlacements[i] === 1 ? C.violet : C.liveLine, color: leaderboardPlacements[i] === 1 ? 'white' : C.liveDim, width: 24, height: 24 }}
                    className="rounded-full flex items-center justify-center text-xs font-bold shrink-0 tabular-nums">{leaderboardPlacements[i]}</div>
                  <span style={{ color: leaderboardPlacements[i] === 1 ? C.liveText : `${C.liveText}99` }} className={`text-sm flex-1 truncate ${leaderboardPlacements[i] === 1 ? 'font-bold' : 'font-medium'}`}>{team.name}</span>
                  <span style={{ color: leaderboardPlacements[i] === 1 ? C.liveText : `${C.liveText}99` }} className="text-sm font-bold tabular-nums">{team.score}</span>
                </div>
              ))}
            </div>
            <TeamAdmissionList gameCode={getHostGameCode()} dark compact hideWhenEmpty className="mt-5" />
          </div>

          <div style={{ borderTop: `1px solid ${C.liveLine}` }} className="p-5 shrink-0">
            <div className="space-y-3">
              <button
                data-host-navigation="back"
                onClick={handleReopenAnswers}
                disabled={actionBusy || phase !== 'closed' || gameScreen === 'round-start' || gameScreen === 'question-results'}
                title={phase === 'revealed' ? 'Revealed scores cannot be safely undone' : undefined}
                style={{ background: 'transparent', color: C.liveText, border: `1px solid ${C.liveLine}` }}
                className="w-full rounded-xl py-3 text-sm font-bold transition-all hover:bg-white/5 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-35"
              >
                {phase === 'closed' && gameScreen !== 'round-start' && gameScreen !== 'question-results'
                  ? '← Reopen Answers'
                  : '← Previous'}
              </button>

              {gameScreen === 'round-start' ? (
                <button data-host-navigation="forward" onClick={handleOpenQuestion} disabled={actionBusy || !question}
                  style={{ background: C.violet, color: 'white', boxShadow: `0 8px 32px ${C.violet}60` }}
                  className="w-full rounded-2xl py-6 text-xl font-extrabold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
                  {actionBusy
                    ? 'Opening…'
                    : firstRoundItem?.kind === 'content'
                      ? 'Show First Content Screen →'
                      : firstRoundItem?.kind === 'show-game'
                        ? 'Start Beat the Bomb →'
                      : `Show Question ${question?.round_position ?? 1} →`}
                </button>
              ) : gameScreen === 'question-results' ? (
                <button data-host-navigation="forward" onClick={handleAdvance} disabled={actionBusy}
                  style={{ background: C.violet, color: 'white', boxShadow: `0 8px 32px ${C.violet}60` }}
                  className="w-full rounded-2xl py-6 text-xl font-extrabold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
                  {actionBusy ? 'Advancing…' : nextLiveItem?.kind === 'content' ? 'Show Content Screen →' : nextLiveItem?.kind === 'show-game' ? `Start ${nextLiveItem.showGame.title} →` : 'Next Question →'}
                </button>
              ) : phase === 'open' ? (
                <button
                  data-host-navigation="forward"
                  onClick={handleCloseAnswers}
                  disabled={actionBusy}
                  style={{
                    background: '#F59E0B',
                    color: '#17130A',
                    border: '2px solid #FBBF24',
                    boxShadow: '0 10px 34px rgba(245,158,11,0.32)',
                  }}
                  className="w-full rounded-2xl py-6 text-xl font-black transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                >
                  {actionBusy
                    ? 'Closing…'
                    : activeBonus && questionStage === 'core' ? 'Close Main Answers →' : activeBonus ? 'Close Bonus Answers →' : 'Close Answers →'}
                </button>
              ) : phase === 'closed' ? (
                <>
                  {activeBonus && questionStage === 'core' ? (
                    <button
                      data-host-navigation="forward"
                      onClick={handleShowBonus}
                      disabled={actionBusy}
                      style={{ background: C.violet, color: 'white', boxShadow: `0 8px 32px ${C.violet}60` }}
                      className="w-full rounded-2xl py-6 text-xl font-extrabold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                    >
                      {actionBusy ? 'Opening…' : 'Open Bonus →'}
                    </button>
                  ) : (
                    <>
                      <button
                        data-host-navigation="forward"
                        onClick={answerRevealMode === 'round' ? handleScoreAndContinue : handleRevealAnswer}
                        disabled={actionBusy || !question || reviewCount > 0}
                        style={{
                          background: reviewCount > 0 ? C.livePanel : C.violet,
                          color: reviewCount > 0 ? C.liveDim : 'white',
                          boxShadow: reviewCount > 0 ? 'none' : `0 8px 32px ${C.violet}60`,
                          border: reviewCount > 0 ? `1px solid ${C.liveLine}` : 'none',
                        }}
                        className="w-full rounded-2xl py-6 text-xl font-extrabold transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {actionBusy
                          ? answerRevealMode === 'round' ? 'Scoring…' : 'Revealing…'
                          : reviewCount > 0
                            ? 'Resolve Reviews First'
                            : answerRevealMode === 'round'
                              ? 'Score & Continue →'
                              : 'Reveal Answer →'}
                      </button>
                      {reviewCount > 0 && (
                        <p style={{ color: C.caution }} className="text-center text-[11px] font-semibold">
                          {reviewCount} answer{reviewCount === 1 ? '' : 's'} still need review
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <button data-host-navigation="forward" onClick={handleAdvance} disabled={actionBusy}
                  style={{ background: C.violet, color: 'white', boxShadow: `0 8px 32px ${C.violet}60` }}
                  className="w-full rounded-2xl py-6 text-xl font-extrabold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
                  {actionBusy
                    ? 'Advancing…'
                    : isFinalQuestion
                      ? 'Finish Game →'
                      : nextIsNewRound
                        ? 'End Round →'
                        : nextLiveItem?.kind === 'content'
                          ? 'Show Content Screen →'
                          : nextLiveItem?.kind === 'show-game'
                            ? `Start ${nextLiveItem.showGame.title} →`
                          : 'Next Question →'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 10: END OF ROUND ──────────────────────────────────────────────────

function EndOfRound({ go }: { go: Go }) {
  const [gameId, setGameId] = useState('')
  const [gameTitle, setGameTitle] = useState('Good Trivia Company')
  const [intermission, setIntermission] = useState(false)
  const [leaderboardVisibility, setLeaderboardVisibility] = useState<LeaderboardVisibility>('round')
  const [answerRevealMode, setAnswerRevealMode] = useState<AnswerRevealMode>('each')
  const [autoRunMode, setAutoRunMode] = useState<AutoRunMode>('off')
  const [roundFinalized, setRoundFinalized] = useState(false)
  const [scoreVisibility, setScoreVisibility] = useState<PlayerScoreVisibility>('live')
  const [revealingAnswers, setRevealingAnswers] = useState(false)
  const [teams, setTeams] = useState<LiveTeam[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<LiveQuestionDefinition | null>(null)
  const [nextQuestion, setNextQuestion] = useState<LiveQuestionDefinition | null>(null)
  const [roundQuestions, setRoundQuestions] = useState<LiveQuestionDefinition[]>([])
  const [currentSubmissions, setCurrentSubmissions] = useState<Pick<LiveSubmission, 'is_correct'>[]>([])
  const [currentBonusSubmissions, setCurrentBonusSubmissions] = useState<Pick<LiveBonusSubmission, 'is_correct'>[]>([])
  const [roundSubmissions, setRoundSubmissions] = useState<LiveSubmission[]>([])
  const [roundBonusSubmissions, setRoundBonusSubmissions] = useState<LiveBonusSubmission[]>([])
  const [reviewAllAnswers, setReviewAllAnswers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function loadRoundSummary() {
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('id, title, current_question_key, current_screen, settings, round_scores_finalized')
        .eq('code', getHostGameCode())
        .maybeSingle()

      if (!active) return
      if (gameError || !game) {
        setError('Could not load the round summary.')
        return
      }

      setIntermission(game.current_screen === 'intermission')
      setGameId(game.id)
      setGameTitle(game.title || 'Good Trivia Company')
      setLeaderboardVisibility(leaderboardVisibilityFromSettings(game.settings))
      setAnswerRevealMode(answerRevealModeFromSettings(game.settings))
      setScoreVisibility(playerScoreVisibilityFromSettings(game.settings))
      const configuredAutoRun = autoRunModeFromSettings(game.settings)
      setAutoRunMode(configuredAutoRun)
      const finalizedForDisplay = configuredAutoRun === 'off' ? true : game.round_scores_finalized
      setRoundFinalized(finalizedForDisplay)
      if (configuredAutoRun === 'off' && !game.round_scores_finalized) {
        await supabase.from('games').update({ round_scores_finalized: true }).eq('id', game.id)
      }
      setRevealingAnswers(game.current_screen === 'delayed-reveal')

      const [{ data: questionRows }, { data: teamRows }] = await Promise.all([
        supabase
          .from('game_questions')
          .select('question_key, position, item_position, round_number, round_position, round_question_count, round_title, prompt, category, difficulty, question_type, correct_answer, accepted_answers, options, image_url, points_max, bonus, notes')
          .eq('game_id', game.id)
          .order('position', { ascending: true }),
        supabase
          .from('teams')
          .select('id, name, score')
          .eq('game_id', game.id)
          .order('score', { ascending: false }),
      ])

      if (!active) return

      const questions = (questionRows ?? []) as LiveQuestionDefinition[]
      const current = questions.find(item => item.question_key === game.current_question_key) ?? null
      const next = current ? questions.find(item => item.round_number > current.round_number) ?? null : null

      setCurrentQuestion(current)
      setNextQuestion(next)
      setRoundQuestions(current ? questions.filter(item => item.round_number === current.round_number) : [])
      setTeams((teamRows ?? []) as LiveTeam[])

      if (current) {
        const roundKeys = questions.filter(item => item.round_number === current.round_number).map(item => item.question_key)
        const [submissionResult, bonusSubmissionResult] = await Promise.all([
          supabase.from('submissions').select('id, team_id, question_key, answer_text, is_correct, points_awarded, grading_json').eq('game_id', game.id).in('question_key', roundKeys),
          supabase.from('bonus_submissions').select('id, team_id, question_key, answer_text, is_correct, points_awarded, grading_json').eq('game_id', game.id).in('question_key', roundKeys),
        ])
        if (active) {
          setRoundSubmissions((submissionResult.data ?? []) as LiveSubmission[])
          setRoundBonusSubmissions((bonusSubmissionResult.data ?? []) as LiveBonusSubmission[])
        }
      }
      setError(null)

      if (!channel) {
        channel = supabase
          .channel(`host-round-summary-${game.id}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${game.id}` },
            () => { void loadRoundSummary() },
          )
          .subscribe()
      }
    }

    void loadRoundSummary()
    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!gameId || !currentQuestion) return
    const questionKey = currentQuestion.question_key
    let active = true
    async function loadRevealAccuracy() {
      const [coreResult, bonusResult] = await Promise.all([
        supabase.from('submissions').select('is_correct').eq('game_id', gameId).eq('question_key', questionKey),
        supabase.from('bonus_submissions').select('is_correct').eq('game_id', gameId).eq('question_key', questionKey),
      ])
      if (!active) return
      setCurrentSubmissions((coreResult.data ?? []) as Pick<LiveSubmission, 'is_correct'>[])
      setCurrentBonusSubmissions((bonusResult.data ?? []) as Pick<LiveBonusSubmission, 'is_correct'>[])
    }
    void loadRevealAccuracy()
    return () => { active = false }
  }, [currentQuestion, gameId])

  async function toggleIntermission() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = !intermission
      await updateLiveGame({ current_screen: next ? 'intermission' : roundResultsScreen(leaderboardVisibility) })
      setIntermission(next)
    } catch (err) {
      console.error('Could not change intermission:', err)
      setError('Could not change the player intermission screen.')
    } finally {
      setBusy(false)
    }
  }

  async function startNextRound() {
    if (!nextQuestion || busy) return
    setBusy(true)
    setError(null)
    try {
      await updateLiveGame({
        status: 'live',
        current_question_key: nextQuestion.question_key,
        current_content_screen_key: null,
        current_screen: 'round-start',
        answer_phase: 'open',
        answer_editing_allowed: false,
        question_stage: 'core',
        round_scores_finalized: false,
      })
      go('live-question')
    } catch (err) {
      console.error('Could not start next round:', err)
      setError('Could not start the next round.')
      setBusy(false)
    }
  }

  async function advanceDelayedReveal() {
    if (!currentQuestion || busy) return
    setBusy(true)
    setError(null)

    try {
      const orderedRoundQuestions = [...roundQuestions].sort((a, b) => a.round_position - b.round_position)
      const currentIndex = orderedRoundQuestions.findIndex(item => item.question_key === currentQuestion.question_key)
      const nextRevealQuestion = currentIndex >= 0 ? orderedRoundQuestions[currentIndex + 1] ?? null : null

      if (nextRevealQuestion) {
        await updateLiveGame({
          current_screen: 'delayed-reveal',
          answer_phase: 'revealed',
          current_question_key: nextRevealQuestion.question_key,
          current_content_screen_key: null,
        })
        setCurrentQuestion(nextRevealQuestion)
        return
      }

      if (nextQuestion) {
        await updateLiveGame({
          status: 'live',
          current_screen: roundResultsScreen(leaderboardVisibility),
          answer_phase: 'closed',
          current_question_key: currentQuestion.question_key,
          current_content_screen_key: null,
        })
        setRevealingAnswers(false)
        return
      }

      if (!gameId) throw new Error('The live game could not be found.')
      await finalizeLiveGame(gameId)
      go('final-results')
    } catch (err) {
      console.error('Could not advance round answers:', err)
      setError('Could not show the next answer.')
    } finally {
      setBusy(false)
    }
  }

  async function reviewRoundSubmission(submission: LiveSubmission, itemIndex: number, status: 'correct' | 'incorrect', bonus = false) {
    const roundQuestion = roundQuestions.find(item => item.question_key === submission.question_key)
    if (!roundQuestion) return
    const bonusDefinition = runtimeBonusFromJson(roundQuestion.bonus)
    const current = bonus && bonusDefinition
      ? storedBonusGrading(bonusDefinition, submission)
      : storedSubmissionGrading(roundQuestion, submission)
    const next: SubmissionGrading = {
      items: current.items.map((item, index) => index === itemIndex ? { ...item, status } : item),
    }
    if (!bonus && roundQuestion.question_type === 'multi-answer') next.missing = multiAnswerMissing(roundQuestion, next)

    const table = bonus ? 'bonus_submissions' : 'submissions'
    const { error: reviewError } = await supabase.from(table).update({ grading_json: next }).eq('id', submission.id)
    if (reviewError) {
      setError('Could not save that review decision.')
      return
    }
    const setter = bonus ? setRoundBonusSubmissions : setRoundSubmissions
    setter(rows => rows.map(row => row.id === submission.id ? { ...row, grading_json: next } : row))
  }

  async function finalizeRound(markPendingIncorrect = false) {
    if (!gameId || !currentQuestion || busy) return
    setBusy(true)
    setError(null)
    try {
      for (const roundQuestion of roundQuestions) {
        const core = roundSubmissions.filter(item => item.question_key === roundQuestion.question_key)
        const bonuses = roundBonusSubmissions.filter(item => item.question_key === roundQuestion.question_key)
        const results = buildConfidentRevealResults(roundQuestion, core)
        const bonusResults = buildConfidentBonusRevealResults(runtimeBonusFromJson(roundQuestion.bonus), bonuses)
        if (results.length > 0 || bonusResults.length > 0) {
          const { error: scoreError } = await supabase.rpc('finalize_auto_run_question_scoring', {
            p_game_id: gameId,
            p_question_key: roundQuestion.question_key,
            p_results: results as unknown as Json,
            p_bonus_results: bonusResults as unknown as Json,
            p_reveal: false,
          })
          if (scoreError) throw scoreError
        }
      }

      const { error: finalizeError } = await supabase.rpc('finalize_auto_run_round', {
        p_game_id: gameId,
        p_round_number: currentQuestion.round_number,
        p_mark_pending_incorrect: markPendingIncorrect,
      })
      if (finalizeError) throw finalizeError
      await updateLiveGame({ current_screen: roundResultsScreen(leaderboardVisibility) })
      setIntermission(false)
      setRoundFinalized(true)
      const { data: refreshedTeams } = await supabase.from('teams').select('id, name, score').eq('game_id', gameId).order('score', { ascending: false })
      setTeams((refreshedTeams ?? []) as LiveTeam[])
    } catch (finalizeError) {
      console.error('Could not finalize Auto-Run round:', finalizeError)
      setError(finalizeError instanceof Error ? finalizeError.message : 'Could not finalize this round.')
    } finally {
      setBusy(false)
    }
  }

  async function viewFinalResults() {
    if (!gameId || busy || (autoRunMode === 'round' && !roundFinalized)) return
    setBusy(true)
    setError(null)
    try {
      await finalizeLiveGame(gameId)
      go('final-results')
    } catch (finalizeError) {
      console.error('Could not finish game:', finalizeError)
      setError('Could not finish the game.')
      setBusy(false)
    }
  }

  const leaderboard = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const leaderboardPlacements = competitionPlacements(leaderboard)
  const roundNumber = currentQuestion?.round_number ?? 1
  const playersSeeRoundLeaderboard = roundResultsScreen(leaderboardVisibility) === 'round-results'
  const revealCorrectness = correctnessSummary(teams.length, currentSubmissions)
  const revealBonusCorrectness = correctnessSummary(teams.length, currentBonusSubmissions)
  const revealBonus = runtimeBonusFromJson(currentQuestion?.bonus)
  const playerScoresAtCheckpoint = scoreVisibility === 'live' || (scoreVisibility === 'round' && roundFinalized)
  const pendingRoundItems = [
    ...roundSubmissions.flatMap(submission => {
      const roundQuestion = roundQuestions.find(item => item.question_key === submission.question_key)
      if (!roundQuestion || submission.is_correct !== null) return []
      const grading = storedSubmissionGrading(roundQuestion, submission)
      return grading.items.flatMap((item, itemIndex) => item.status === 'review' ? [{ submission, question: roundQuestion, item, itemIndex, bonus: false }] : [])
    }),
    ...roundBonusSubmissions.flatMap(submission => {
      const roundQuestion = roundQuestions.find(item => item.question_key === submission.question_key)
      const bonus = runtimeBonusFromJson(roundQuestion?.bonus)
      if (!roundQuestion || !bonus || submission.is_correct !== null) return []
      const grading = storedBonusGrading(bonus, submission)
      return grading.items.flatMap((item, itemIndex) => item.status === 'review' ? [{ submission, question: roundQuestion, item, itemIndex, bonus: true }] : [])
    }),
  ]

  if (answerRevealMode === 'round' && revealingAnswers && currentQuestion) {
    const orderedRoundQuestions = [...roundQuestions].sort((a, b) => a.round_position - b.round_position)
    const revealIndex = orderedRoundQuestions.findIndex(item => item.question_key === currentQuestion.question_key)
    const hasNextReveal = revealIndex >= 0 && revealIndex < orderedRoundQuestions.length - 1

    return (
      <div style={{ background: C.liveBg, color: C.liveText }} className="min-h-screen flex flex-col">
        <header style={{ background: C.liveSurface, borderBottom: `1px solid ${C.liveLine}` }} className="h-12 flex items-center px-6 shrink-0">
          <BrandWordmark dark compact className="text-sm" />
          <div className="flex-1 text-center text-sm font-semibold" style={{ color: C.liveDim }}>
            Round {currentQuestion.round_number} answers · {revealIndex + 1} of {orderedRoundQuestions.length}
          </div>
          <div className="flex items-center gap-4">
            <span style={{ color: '#C4B5FD' }} className="text-xs font-bold">REVEALING TO PLAYERS</span>
            <JoinCodeButton dark />
            <CancelGameButton go={go} dark />
            <button onClick={() => exitHostSession(go)} style={{ color: C.liveDim }} className="text-xs font-semibold hover:text-white">Exit to My Quizzes</button>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-8 py-10">
          <section style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="w-full max-w-4xl rounded-3xl p-8 text-center shadow-2xl">
            <p style={{ color: '#C4B5FD' }} className="text-[11px] font-extrabold uppercase tracking-[0.2em]">Players are seeing</p>
            <p style={{ color: C.liveDim }} className="mt-5 text-sm">Question {currentQuestion.round_position} of {currentQuestion.round_question_count}</p>
            <h1 className="mx-auto mt-3 max-w-3xl text-3xl font-black leading-tight">{currentQuestion.prompt}</h1>
            <div style={{ background: `${C.go}18`, border: `1px solid ${C.go}45` }} className="mx-auto mt-7 max-w-xl rounded-2xl px-5 py-4">
              <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest">Correct answer</p>
              <p style={{ color: C.go }} className="mt-2 text-2xl font-extrabold">{correctAnswerDisplay(currentQuestion)}</p>
            </div>
            {teams.length > 0 && (
              <div className="mt-5">
                <p style={{ color: C.liveDim }} className="text-[10px] font-extrabold uppercase tracking-[0.18em]">Host insight</p>
                <div className="mx-auto mt-2 flex max-w-xl flex-wrap justify-center gap-3">
                  <span style={{ background: `${C.go}18`, color: C.go, border: `1px solid ${C.go}40` }} className="rounded-2xl px-7 py-4 text-center tabular-nums shadow-lg">
                    <strong className="block text-4xl font-black leading-none">{revealCorrectness.percentage}%</strong>
                    <span className="mt-2 block text-xs font-extrabold uppercase tracking-wide">{revealCorrectness.correct} of {revealCorrectness.total} teams correct</span>
                  </span>
                  {revealBonus && (
                    <span style={{ background: `${C.violet}18`, color: C.liveViolet, border: `1px solid ${C.violet}40` }} className="rounded-2xl px-6 py-4 text-center tabular-nums">
                      <strong className="block text-3xl font-black leading-none">{revealBonusCorrectness.percentage}%</strong>
                      <span className="mt-2 block text-[11px] font-extrabold uppercase tracking-wide">Bonus · {revealBonusCorrectness.correct} of {revealBonusCorrectness.total}</span>
                    </span>
                  )}
                </div>
              </div>
            )}
            <p style={{ color: C.liveDim }} className="mt-5 text-sm">Each team also sees its own submitted answer, result, and points.</p>
            {error && <p style={{ color: C.stop }} className="mt-5 text-sm font-semibold">{error}</p>}
            <button data-host-navigation="forward" onClick={advanceDelayedReveal} disabled={busy} style={{ background: C.violet }} className="mt-8 min-w-72 rounded-2xl px-8 py-5 text-xl font-extrabold text-white hover:opacity-90 disabled:opacity-50">
              {busy
                ? 'Advancing…'
                : hasNextReveal
                  ? 'Show Next Answer →'
                  : nextQuestion
                    ? 'Show Round Results →'
                    : 'Show Final Results →'}
            </button>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div style={{ background: C.liveBg, color: C.liveText }} className="min-h-screen flex flex-col">
      <header style={{ background: C.liveSurface, borderBottom: `1px solid ${C.liveLine}` }} className="h-12 flex items-center px-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <BrandWordmark dark compact className="text-sm" />
        </div>
        <div className="flex-1 text-center"><span style={{ color: C.liveDim }} className="text-sm">{gameTitle}</span></div>
        <div className="flex items-center gap-3">
          <JoinCodeButton dark />
          <CancelGameButton go={go} dark />
          <button onClick={() => exitHostSession(go)} style={{ color: '#ffffff80' }} className="text-xs font-semibold hover:text-white">Exit to My Quizzes</button>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
        <div className="text-center mb-10">
          <div style={{ background: `${C.go}15`, color: C.go, border: `1px solid ${C.go}30` }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-5">✓ Round Complete</div>
          <h1 style={{ color: C.liveText }} className="text-5xl font-extrabold">Round {roundNumber} Complete</h1>
          <p style={{ color: C.liveDim }} className="mt-2 text-sm">
            {nextQuestion ? `Next up: Round ${nextQuestion.round_number} · ${nextQuestion.round_title}` : 'That was the final round.'}
          </p>
        </div>

        {error && <div style={{ background: `${C.stop}18`, border: `1px solid ${C.stop}55`, color: '#FCA5A5' }} className="rounded-xl px-4 py-3 mb-5 text-sm font-semibold">{error}</div>}

        {autoRunMode === 'round' && (
          <section style={{ background: C.liveSurface, border: `1px solid ${roundFinalized ? `${C.go}55` : `${C.violet}70`}` }} className="mb-7 rounded-2xl p-5 shadow-2xl">
            <div>
              <div>
                <p style={{ color: roundFinalized ? C.go : '#C4B5FD' }} className="text-xs font-black uppercase tracking-wider">Host checkpoint</p>
                <h2 className="mt-1 text-xl font-extrabold">{roundFinalized ? 'Round finalized' : `${pendingRoundItems.length} answer${pendingRoundItems.length === 1 ? '' : 's'} need review`}</h2>
                <p style={{ color: C.liveDim }} className="mt-1 text-xs">{roundFinalized ? 'Scores for this round are now official.' : 'Auto-Run is stopped. Resolve these answers, then finalize the round.'}</p>
              </div>
            </div>

            {!roundFinalized && pendingRoundItems.length > 0 && (
              <div className="mt-4 space-y-2">
                {pendingRoundItems.map(({ submission, question: pendingQuestion, item, itemIndex, bonus }) => (
                  <div key={`${bonus ? 'bonus' : 'main'}-${submission.id}-${itemIndex}`} style={{ background: C.livePanel, border: `1px solid ${C.caution}55` }} className="rounded-xl p-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-wider">{teams.find(team => team.id === submission.team_id)?.name ?? 'Team'} · Q{pendingQuestion.round_position}{bonus ? ' bonus' : ''}</p>
                        <p className="mt-1 truncate text-sm font-bold">{item.submitted || '—'} <span style={{ color: C.liveDim }}>→</span> <span style={{ color: C.go }}>{item.expected ?? '—'}</span></p>
                      </div>
                      <ReviewBadge status="review" onCorrect={() => { void reviewRoundSubmission(submission, itemIndex, 'correct', bonus) }} onIncorrect={() => { void reviewRoundSubmission(submission, itemIndex, 'incorrect', bonus) }} />
                    </div>
                  </div>
                ))}
                <button type="button" disabled={busy} onClick={() => {
                  if (window.confirm(`${pendingRoundItems.length} answer${pendingRoundItems.length === 1 ? ' is' : 's are'} still awaiting review. Mark all pending answers incorrect and finalize this round?`)) void finalizeRound(true)
                }} style={{ color: '#FCA5A5' }} className="cursor-pointer text-xs font-bold hover:underline disabled:cursor-not-allowed disabled:opacity-50">
                  Mark all pending incorrect &amp; finalize
                </button>
              </div>
            )}

            {!roundFinalized && (
              <div className="mt-4" style={{ borderTop: `1px solid ${C.liveLine}` }}>
                <button
                  type="button"
                  onClick={() => setReviewAllAnswers(value => !value)}
                  style={{ background: reviewAllAnswers ? C.livePanel : C.violet, color: 'white' }}
                  className="mt-4 w-full cursor-pointer rounded-xl px-5 py-3 text-sm font-extrabold transition-all hover:brightness-110"
                >
                  {reviewAllAnswers ? 'Hide all answers' : 'Check all other answers'}
                </button>

                {reviewAllAnswers && (
                  <div className="mt-4 space-y-4">
                    {roundQuestions.slice().sort((a, b) => a.round_position - b.round_position).map(auditQuestion => {
                      const auditBonus = runtimeBonusFromJson(auditQuestion.bonus)
                      return (
                        <section key={auditQuestion.question_key} style={{ background: C.livePanel, border: `1px solid ${C.liveLine}` }} className="rounded-2xl p-4">
                          <p style={{ color: '#C4B5FD' }} className="text-[10px] font-black uppercase tracking-wider">Question {auditQuestion.round_position}</p>
                          <h3 className="mt-1 text-sm font-extrabold leading-5">{auditQuestion.prompt}</h3>
                          <p style={{ color: C.go }} className="mt-1 text-xs font-bold">Answer: {correctAnswerDisplay(auditQuestion)}</p>
                          <div className="mt-3 space-y-2">
                            {teams.map(team => {
                              const coreSubmission = roundSubmissions.find(item => item.question_key === auditQuestion.question_key && item.team_id === team.id) ?? null
                              const bonusSubmission = roundBonusSubmissions.find(item => item.question_key === auditQuestion.question_key && item.team_id === team.id) ?? null
                              const coreGrading = coreSubmission ? storedSubmissionGrading(auditQuestion, coreSubmission) : null
                              const bonusGrading = bonusSubmission && auditBonus ? storedBonusGrading(auditBonus, bonusSubmission) : null
                              return (
                                <div key={team.id} style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="rounded-xl p-3">
                                  <p style={{ color: C.liveText }} className="mb-2 text-xs font-extrabold">{team.name}</p>
                                  {!coreSubmission ? (
                                    <p style={{ color: C.liveDim }} className="text-xs italic">No answer submitted</p>
                                  ) : coreGrading?.items.map((item, itemIndex) => (
                                    <div key={`core-${itemIndex}`} className="mb-1.5 grid items-center gap-2 last:mb-0" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                                      <p className="min-w-0 truncate text-xs font-semibold" title={item.submitted}>{item.label ? `${item.label}: ` : ''}{item.submitted || '—'}{item.expected && item.status !== 'correct' ? <span style={{ color: C.go }}> → {item.expected}</span> : null}</p>
                                      <ReviewBadge status={item.status} onCorrect={() => { void reviewRoundSubmission(coreSubmission, itemIndex, 'correct') }} onIncorrect={() => { void reviewRoundSubmission(coreSubmission, itemIndex, 'incorrect') }} />
                                    </div>
                                  ))}
                                  {auditBonus && (
                                    <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.liveLine}` }}>
                                      <p style={{ color: '#C4B5FD' }} className="mb-1 text-[10px] font-black uppercase">Bonus</p>
                                      {!bonusSubmission || !bonusGrading ? <p style={{ color: C.liveDim }} className="text-xs italic">No bonus answer submitted</p> : bonusGrading.items.map((item, itemIndex) => (
                                        <div key={`bonus-${itemIndex}`} className="grid items-center gap-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                                          <p className="min-w-0 truncate text-xs font-semibold">{item.submitted || '—'}{item.expected && item.status !== 'correct' ? <span style={{ color: C.go }}> → {item.expected}</span> : null}</p>
                                          <ReviewBadge status={item.status} onCorrect={() => { void reviewRoundSubmission(bonusSubmission, itemIndex, 'correct', true) }} onIncorrect={() => { void reviewRoundSubmission(bonusSubmission, itemIndex, 'incorrect', true) }} />
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                )}

                <div className="mt-5 border-t pt-4" style={{ borderColor: C.liveLine }}>
                  <button
                    type="button"
                    disabled={busy || pendingRoundItems.length > 0}
                    onClick={() => { void finalizeRound(false) }}
                    style={{ background: pendingRoundItems.length > 0 ? C.livePanel : C.go, color: pendingRoundItems.length > 0 ? C.liveDim : 'white' }}
                    className="w-full cursor-pointer rounded-xl px-5 py-3 text-sm font-extrabold disabled:cursor-not-allowed"
                  >
                    {busy ? 'Finalizing…' : 'Finalize Round'}
                  </button>
                  {pendingRoundItems.length > 0 && (
                    <p style={{ color: C.liveDim }} className="mt-2 text-center text-xs">Resolve the highlighted answers before finalizing.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        <section style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="mb-7 overflow-hidden rounded-2xl text-center shadow-2xl">
          <div style={{ borderBottom: `1px solid ${C.liveLine}`, color: '#C4B5FD' }} className="px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em]">
            Players are seeing
          </div>
          {intermission ? (
            <div className="px-8 py-9">
              <p style={{ color: C.liveDim }} className="text-sm">Round {roundNumber} complete</p>
              <h2 style={{ color: C.liveText }} className="mt-2 text-3xl font-extrabold">Intermission</h2>
              <p style={{ color: C.liveDim }} className="mt-2 text-sm">The next round will begin shortly.</p>
              <p style={{ color: '#C4B5FD' }} className="mt-5 text-xs font-bold">{playerScoresAtCheckpoint ? 'Each team can see its official score.' : 'Scores remain hidden from players.'}</p>
            </div>
          ) : playersSeeRoundLeaderboard ? (
            <div className="px-8 py-8">
              <h2 style={{ color: C.liveText }} className="text-3xl font-extrabold">Round {roundNumber} Complete</h2>
              <p style={{ color: '#C4B5FD' }} className="mt-3 text-sm font-bold">{playerScoresAtCheckpoint ? 'The full leaderboard and official scores are visible.' : 'The leaderboard is visible; point totals remain hidden.'}</p>
            </div>
          ) : (
            <div className="px-8 py-8">
              <h2 style={{ color: C.liveText }} className="text-3xl font-extrabold">Round {roundNumber} Complete</h2>
              <p style={{ color: '#C4B5FD' }} className="mt-3 text-sm font-bold">{playerScoresAtCheckpoint ? 'Each team sees only its own official score.' : 'Scores remain hidden from players.'}</p>
              <p style={{ color: C.liveDim }} className="mt-1 text-xs">Team names, ranks, and the full standings are hidden.</p>
            </div>
          )}
        </section>

        <div style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="rounded-2xl p-5 mb-7 shadow-2xl">
          <p style={{ color: C.liveDim }} className="text-[11px] font-bold uppercase tracking-wider mb-4">
            Current Standings · {playersSeeRoundLeaderboard && !intermission ? 'Also visible to players' : 'Host only'}
          </p>
          <div className="space-y-1.5">
            {leaderboard.map((team, i) => (
              <div key={team.id} style={{ background: leaderboardPlacements[i] <= 3 ? C.livePanel : 'transparent', border: `1px solid ${leaderboardPlacements[i] <= 3 ? C.liveLine : 'transparent'}` }} className="flex items-center gap-4 p-3 rounded-xl">
                <div style={{ background: leaderboardPlacements[i] === 1 ? C.violet : C.liveLine, color: leaderboardPlacements[i] === 1 ? 'white' : C.liveDim, border: `1px solid ${leaderboardPlacements[i] === 1 ? C.violet : C.liveLine}`, width: 32, height: 32 }}
                  className="rounded-full flex items-center justify-center text-sm font-extrabold shrink-0">{leaderboardPlacements[i]}</div>
                <span style={{ color: C.liveText }} className="flex-1 text-sm font-semibold">{team.name}</span>
                <span style={{ color: C.liveText }} className="font-extrabold tabular-nums">{team.score}</span>
              </div>
            ))}
          </div>
        </div>

        <TeamAdmissionList gameCode={getHostGameCode()} dark compact hideWhenEmpty className="mb-7" />

        <div className="flex gap-3 mb-6">
          <button
            type="button"
            onClick={toggleIntermission}
            disabled={busy || (autoRunMode === 'round' && !roundFinalized)}
            style={{ background: C.livePanel, border: `1px solid ${C.liveLine}`, color: C.liveText }}
            className="flex-1 cursor-pointer rounded-xl px-5 py-3.5 text-sm font-semibold transition-all hover:brightness-125 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {autoRunMode === 'round' && !roundFinalized ? 'Players waiting for finalization' : intermission ? 'Hide Intermission' : 'Take a Break'}
          </button>
          {nextQuestion ? (
            <button
              type="button"
              data-host-navigation="forward"
              onClick={startNextRound}
              disabled={busy || (autoRunMode === 'round' && !roundFinalized)}
              style={{ background: C.violet, color: 'white', boxShadow: `0 8px 28px ${C.violet}45` }}
              className="flex-1 cursor-pointer rounded-xl px-6 py-3.5 text-base font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start Round {nextQuestion.round_number}
            </button>
          ) : (
            <button
              type="button"
              data-host-navigation="forward"
              onClick={viewFinalResults}
              disabled={busy || (autoRunMode === 'round' && !roundFinalized)}
              style={{ background: C.violet, color: 'white', boxShadow: `0 8px 28px ${C.violet}45` }}
              className="flex-1 cursor-pointer rounded-xl px-6 py-3.5 text-base font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              View Final Results
            </button>
          )}
        </div>

      </main>
    </div>
  )
}

// ─── SCREEN 11: FINAL RESULTS ─────────────────────────────────────────────────

type HostFinalGame = {
  id: string
  title: string
  status: string
  current_screen: string
  current_tiebreaker_attempt_id: string | null
  settings: Json
}

type HostTieResolution = Database['public']['Tables']['game_tie_resolutions']['Row']
type HostTiebreakerAttempt = Database['public']['Tables']['game_tiebreaker_attempts']['Row']
type HostTiebreakerSubmission = Database['public']['Tables']['game_tiebreaker_submissions']['Row']
type HostPreparedTiebreaker = Database['public']['Tables']['game_tiebreakers']['Row']
type TieResolutionChoice = 'tiebreaker' | 'allowed_tie' | 'manual'

function TieResolutionChooser({
  selected,
  onSelect,
  onConfirm,
  unusedTiebreakerCount,
  busy,
  runLabel = 'Run a Tiebreaker',
}: {
  selected: TieResolutionChoice | null
  onSelect: (choice: TieResolutionChoice) => void
  onConfirm: () => void
  unusedTiebreakerCount: number
  busy: boolean
  runLabel?: string
}) {
  const choices: { id: TieResolutionChoice; label: string; description: string; disabled?: boolean }[] = [
    {
      id: 'tiebreaker',
      label: runLabel,
      description: `${unusedTiebreakerCount} prepared question${unusedTiebreakerCount === 1 ? '' : 's'} available`,
      disabled: unusedTiebreakerCount === 0,
    },
    { id: 'allowed_tie', label: 'Allow the Tie', description: 'Keep the equal placement.' },
    { id: 'manual', label: 'Choose Manually', description: 'Set the tied teams’ order yourself.' },
  ]
  const selectedLabel = choices.find(choice => choice.id === selected)?.label

  return (
    <div>
      <p style={{ color: C.ink }} className="mb-3 text-center text-sm font-bold">Select one option, then confirm.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {choices.map(choice => {
          const isSelected = selected === choice.id
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(choice.id)}
              disabled={busy || choice.disabled}
              style={{
                background: isSelected ? C.violetPale : C.panel,
                border: `2px solid ${isSelected ? C.violet : C.line}`,
                color: C.ink,
              }}
              className="cursor-pointer rounded-2xl p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/40 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-lg font-extrabold">{choice.label}</span>
                <span
                  aria-hidden="true"
                  style={{
                    background: isSelected ? C.violet : C.panel,
                    border: `2px solid ${isSelected ? C.violet : C.line}`,
                    color: 'white',
                  }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black"
                >
                  {isSelected ? '✓' : ''}
                </span>
              </span>
              <span style={{ color: C.sub }} className="mt-2 block text-xs">{choice.description}</span>
            </button>
          )
        })}
      </div>
      <Btn sz="lg" cls="mt-4 w-full justify-center" onClick={onConfirm} disabled={busy || !selected}>
        {selectedLabel ? `Confirm: ${selectedLabel}` : 'Select an option to continue'}
      </Btn>
      {unusedTiebreakerCount === 0 && (
        <p style={{ color: C.caution }} className="mt-3 text-center text-sm font-semibold">No unused prepared tiebreakers remain. Allow the tie or choose the order manually.</p>
      )}
    </div>
  )
}

function FinalResults({ go }: { go: Go }) {
  const [game, setGame] = useState<HostFinalGame | null>(null)
  const [teams, setTeams] = useState<LiveTeam[]>([])
  const [resolutions, setResolutions] = useState<HostTieResolution[]>([])
  const [attempts, setAttempts] = useState<HostTiebreakerAttempt[]>([])
  const [preparedTiebreakers, setPreparedTiebreakers] = useState<HostPreparedTiebreaker[]>([])
  const [tiebreakerSubmissions, setTiebreakerSubmissions] = useState<HostTiebreakerSubmission[]>([])
  const [manualOrder, setManualOrder] = useState<string[]>([])
  const [manualMode, setManualMode] = useState(false)
  const [selectedTieChoice, setSelectedTieChoice] = useState<TieResolutionChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFinal = useCallback(async () => {
    const { data: gameRow, error: gameError } = await supabase
      .from('games')
      .select('id, title, status, current_screen, current_tiebreaker_attempt_id, settings')
      .eq('code', getHostGameCode())
      .maybeSingle()
    if (gameError || !gameRow) {
      setError('Could not load the final game state.')
      return
    }

    const [teamResult, resolutionResult, attemptResult, preparedResult, submissionResult] = await Promise.all([
      supabase.from('teams').select('id, name, score, prize_awards, final_placement, final_bottom_placement, final_sort_order').eq('game_id', gameRow.id),
      supabase.from('game_tie_resolutions').select('*').eq('game_id', gameRow.id).order('created_at'),
      supabase.from('game_tiebreaker_attempts').select('*').eq('game_id', gameRow.id).order('created_at'),
      supabase.from('game_tiebreakers').select('*').eq('game_id', gameRow.id).order('position'),
      supabase.from('game_tiebreaker_submissions').select('*').eq('game_id', gameRow.id).order('created_at'),
    ])
    const loadError = teamResult.error || resolutionResult.error || attemptResult.error || preparedResult.error || submissionResult.error
    if (loadError) {
      console.error('Could not load tiebreaker state:', loadError)
      setError('Could not load the tiebreaker state. Please try again.')
      return
    }

    setGame(gameRow as HostFinalGame)
    setTeams((teamResult.data ?? []) as LiveTeam[])
    setResolutions((resolutionResult.data ?? []) as HostTieResolution[])
    setAttempts((attemptResult.data ?? []) as HostTiebreakerAttempt[])
    setPreparedTiebreakers((preparedResult.data ?? []) as HostPreparedTiebreaker[])
    setTiebreakerSubmissions((submissionResult.data ?? []) as HostTiebreakerSubmission[])
    setError(null)
  }, [])

  useEffect(() => {
    // The first async read synchronizes this screen with the persisted live game.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFinal()
    const gameId = localStorage.getItem('simple-trivia-host-game-id')
    if (!gameId) return
    const channel = supabase
      .channel(`host-final-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, () => { void loadFinal() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${gameId}` }, () => { void loadFinal() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_tiebreaker_submissions', filter: `game_id=eq.${gameId}` }, () => { void loadFinal() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [loadFinal])

  const leaderboardVisibility = leaderboardVisibilityFromSettings(game?.settings)
  const leaderboard = [...teams].sort((a, b) => {
    if (a.final_sort_order !== null && a.final_sort_order !== undefined && b.final_sort_order !== null && b.final_sort_order !== undefined) {
      return a.final_sort_order - b.final_sort_order
    }
    return b.score - a.score || a.name.localeCompare(b.name)
  })
  const winners = leaderboard.filter(team => (team.final_placement ?? 1) === 1)
  const pendingResolution = resolutions.find(resolution => resolution.status === 'pending') ?? null
  const activeAttempt = attempts.find(attempt => attempt.id === game?.current_tiebreaker_attempt_id)
    ?? attempts.filter(attempt => attempt.resolution_id === pendingResolution?.id).at(-1)
    ?? null
  const displayResolution = pendingResolution
    ?? resolutions.find(resolution => resolution.id === activeAttempt?.resolution_id)
    ?? null
  const activePrepared = preparedTiebreakers.find(item => item.id === activeAttempt?.game_tiebreaker_id) ?? null
  const activeSubmissions = tiebreakerSubmissions.filter(submission => submission.attempt_id === activeAttempt?.id)
  const closestTeamIds = closestTiebreakerTeamIds(activeSubmissions.map(submission => ({
    teamId: submission.team_id,
    distance: submission.distance,
  })))
  const tiedTeams = displayResolution
    ? displayResolution.team_ids.flatMap(teamId => teams.find(team => team.id === teamId) ?? [])
    : []
  const unusedTiebreakerCount = preparedTiebreakers.filter(item => !attempts.some(attempt => attempt.game_tiebreaker_id === item.id)).length
  const resolvingTie = game?.status !== 'finished' && displayResolution !== null
  const prizeWinners = leaderboard.flatMap(team =>
    prizeAwardsFromJson(team.prize_awards).map((award: PrizeAward) => ({ team, award })),
  )

  async function runAction(action: () => PromiseLike<unknown>, message: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      setManualMode(false)
      setSelectedTieChoice(null)
      await loadFinal()
    } catch (actionError) {
      console.error(message, actionError)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function startTiebreaker() {
    if (!pendingResolution) return
    void runAction(
      () => supabase.rpc('start_game_tiebreaker', { p_resolution_id: pendingResolution.id }).then(({ error: rpcError }) => { if (rpcError) throw rpcError }),
      'Could not start the prepared tiebreaker.',
    )
  }

  function closeTiebreaker() {
    if (!activeAttempt) return
    void runAction(
      () => supabase.rpc('close_game_tiebreaker', { p_attempt_id: activeAttempt.id }).then(({ error: rpcError }) => { if (rpcError) throw rpcError }),
      'Could not close tiebreaker answers.',
    )
  }

  function revealTiebreaker() {
    if (!activeAttempt) return
    void runAction(
      () => supabase.rpc('reveal_game_tiebreaker', { p_attempt_id: activeAttempt.id }).then(({ error: rpcError }) => { if (rpcError) throw rpcError }),
      'Could not reveal the tiebreaker result.',
    )
  }

  function finalizeAfterResolution(action: () => PromiseLike<unknown>) {
    if (!game) return
    void runAction(async () => {
      await action()
      await finalizeLiveGame(game.id)
    }, 'Could not save the final placement decision.')
  }

  function allowTie() {
    if (!pendingResolution) return
    finalizeAfterResolution(() => supabase.rpc('allow_game_tie', { p_resolution_id: pendingResolution.id }).then(({ error: rpcError }) => { if (rpcError) throw rpcError }))
  }

  function saveManualOrder() {
    if (!pendingResolution || manualOrder.length !== pendingResolution.team_ids.length) return
    finalizeAfterResolution(() => supabase.rpc('manually_resolve_game_tie', {
      p_resolution_id: pendingResolution.id,
      p_ordered_team_ids: manualOrder,
    }).then(({ error: rpcError }) => { if (rpcError) throw rpcError }))
  }

  function continueAfterTiebreaker() {
    if (!game) return
    void runAction(() => finalizeLiveGame(game.id), 'Could not continue to the final results.')
  }

  function beginManualOrder() {
    if (!pendingResolution) return
    setManualOrder([...pendingResolution.team_ids])
    setSelectedTieChoice(null)
    setManualMode(true)
  }

  function confirmTieResolutionChoice() {
    if (selectedTieChoice === 'tiebreaker') startTiebreaker()
    if (selectedTieChoice === 'allowed_tie') allowTie()
    if (selectedTieChoice === 'manual') beginManualOrder()
  }

  function moveManualTeam(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= manualOrder.length) return
    const next = [...manualOrder]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    setManualOrder(next)
  }

  function finishAndReturn() {
    localStorage.removeItem('simple-trivia-host-game-id')
    localStorage.removeItem('simple-trivia-host-game-code')
    localStorage.removeItem('simple-trivia-host-game-title')
    go('dashboard')
  }

  return (
    <div style={{ background: resolvingTie ? C.ground : C.liveBg }} className="min-h-screen flex flex-col">
      <header style={{ background: C.ink }} className="h-12 flex items-center px-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <BrandWordmark dark compact className="text-sm" />
        </div>
        <div className="flex-1 text-center"><span style={{ color: '#ffffff50' }} className="text-sm">{game?.title ?? 'Good Trivia Company'}</span></div>
        <div style={{ width: 80 }} />
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
        {resolvingTie && displayResolution ? (
          <>
            <div className="text-center mb-8">
              <div style={{ background: '#FEF3C7', color: '#92400E' }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-4">Final placement tie</div>
              <h1 style={{ color: C.ink }} className="text-4xl font-extrabold">These teams are tied on {displayResolution.tied_score}</h1>
              <p style={{ color: C.sub }} className="mt-3 text-sm">Resolve their placement without changing either team’s trivia score.</p>
            </div>

            {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: C.stop }} className="mb-5 rounded-xl px-4 py-3 text-sm font-semibold">{error}</div>}

            {activeAttempt && activePrepared && game?.current_screen !== 'tiebreaker-pending' && !manualMode ? (
              <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-3xl p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <p style={{ color: C.violet }} className="text-xs font-extrabold uppercase tracking-widest">Closest answer wins</p>
                  <span style={{ color: C.sub }} className="text-xs font-bold">{activeSubmissions.length} / {activeAttempt.team_ids.length} answered</span>
                </div>
                <h2 style={{ color: C.ink }} className="mt-4 text-2xl font-extrabold leading-snug">{activePrepared.prompt}</h2>
                <p style={{ color: C.go }} className="mt-3 text-sm font-bold">Correct answer: {activePrepared.correct_value}{activePrepared.answer_unit ? ` ${activePrepared.answer_unit}` : ''}</p>

                <div className="mt-6 space-y-2">
                  {tiedTeams.map(team => {
                    const submission = activeSubmissions.find(item => item.team_id === team.id)
                    const isClosest = closestTeamIds.has(team.id)
                    return (
                      <div key={team.id} style={{ background: isClosest ? '#F0FDF4' : C.ground, border: `1px solid ${isClosest ? C.go : C.line}` }} className="flex items-center gap-3 rounded-xl px-4 py-3">
                        <span style={{ color: isClosest ? C.go : C.ink }} className="flex-1 text-sm font-bold">{team.name}</span>
                        {isClosest && <span style={{ color: C.go }} className="text-[10px] font-extrabold uppercase tracking-wider">Closest</span>}
                        <span style={{ color: isClosest ? C.go : submission ? C.ink : C.sub }} className="text-sm font-extrabold tabular-nums">
                          {submission ? submission.numeric_answer : 'Waiting…'}
                        </span>
                        {submission?.distance !== null && submission?.distance !== undefined && (
                          <span style={{ color: C.sub }} className="text-xs">off by {submission.distance}</span>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="mt-6 flex gap-3">
                  {activeAttempt.status === 'open' && (
                    <Btn sz="lg" cls="flex-1 justify-center" onClick={closeTiebreaker} disabled={busy || activeSubmissions.length !== activeAttempt.team_ids.length}>Close Answers</Btn>
                  )}
                  {activeAttempt.status === 'closed' && (
                    <Btn sz="lg" cls="flex-1 justify-center" onClick={revealTiebreaker} disabled={busy}>Reveal Closest Answer</Btn>
                  )}
                  {activeAttempt.status === 'resolved' && (
                    <Btn sz="lg" cls="flex-1 justify-center" onClick={continueAfterTiebreaker} disabled={busy}>Continue to Final Results</Btn>
                  )}
                  {activeAttempt.status === 'tied' && (
                    <div className="w-full">
                      <TieResolutionChooser
                        selected={selectedTieChoice}
                        onSelect={setSelectedTieChoice}
                        onConfirm={confirmTieResolutionChoice}
                        unusedTiebreakerCount={unusedTiebreakerCount}
                        busy={busy}
                        runLabel="Run Next Tiebreaker"
                      />
                    </div>
                  )}
                </div>
                {activeAttempt.status === 'tied' && <p style={{ color: C.caution }} className="mt-3 text-center text-sm font-bold">Two or more teams were equally close, so the tie remains unresolved.</p>}
              </div>
            ) : manualMode ? (
              <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-3xl p-6 shadow-sm">
                <h2 style={{ color: C.ink }} className="text-xl font-extrabold">Choose the final order</h2>
                <p style={{ color: C.sub }} className="mt-1 text-sm">Put the highest-placed team first. Scores will not change.</p>
                <div className="mt-5 space-y-2">
                  {manualOrder.map((teamId, index) => {
                    const team = teams.find(item => item.id === teamId)
                    return <div key={teamId} style={{ background: C.ground, border: `1px solid ${C.line}` }} className="flex items-center gap-3 rounded-xl px-4 py-3">
                      <span style={{ color: C.violet }} className="w-6 text-sm font-extrabold">{index + 1}</span>
                      <span style={{ color: C.ink }} className="flex-1 text-sm font-bold">{team?.name ?? 'Team'}</span>
                      <button onClick={() => moveManualTeam(index, -1)} disabled={index === 0} className="rounded-lg px-2 py-1 text-sm font-bold disabled:opacity-25">↑</button>
                      <button onClick={() => moveManualTeam(index, 1)} disabled={index === manualOrder.length - 1} className="rounded-lg px-2 py-1 text-sm font-bold disabled:opacity-25">↓</button>
                    </div>
                  })}
                </div>
                <div className="mt-6 flex gap-3">
                  <Btn v="secondary" sz="md" cls="flex-1 justify-center" onClick={() => setManualMode(false)} disabled={busy}>Back</Btn>
                  <Btn sz="lg" cls="flex-1 justify-center" onClick={saveManualOrder} disabled={busy}>Confirm Order</Btn>
                </div>
              </div>
            ) : (
              <TieResolutionChooser
                selected={selectedTieChoice}
                onSelect={setSelectedTieChoice}
                onConfirm={confirmTieResolutionChoice}
                unusedTiebreakerCount={unusedTiebreakerCount}
                busy={busy}
              />
            )}
          </>
        ) : (
        <>
        <div className="text-center mb-10">
          <div style={{ background: `${C.violet}22`, color: C.liveViolet, border: `1px solid ${C.violet}55` }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-4">★ Game Complete</div>
          <h1 style={{ color: C.liveText }} className="text-5xl font-extrabold">What a game!</h1>
        </div>

        <div
          style={{
            background: playersSeeFinalLeaderboard(leaderboardVisibility) ? `${C.go}16` : `${C.caution}16`,
            border: `1px solid ${playersSeeFinalLeaderboard(leaderboardVisibility) ? `${C.go}55` : `${C.caution}55`}`,
            color: playersSeeFinalLeaderboard(leaderboardVisibility) ? '#6EE7B7' : '#FCD34D',
          }}
          className="mb-7 rounded-2xl px-5 py-4 text-center"
        >
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em]">Players are seeing</p>
          <p className="mt-1 text-sm font-bold">
            {playersSeeFinalLeaderboard(leaderboardVisibility)
              ? 'Their final place, score, and the full final standings.'
              : 'Only their own final score. Team names, places, and standings remain hidden.'}
          </p>
        </div>

        {winners.length > 0 && (
          <div style={{ background: C.violet, color: 'white' }} className="rounded-3xl p-8 text-center mb-8 shadow-xl">
            <div className="text-4xl mb-2">🏆</div>
            <p className="text-sm font-bold uppercase tracking-widest opacity-80">{winners.length === 1 ? 'Winner' : 'Joint Winners'}</p>
            <h2 className="text-3xl font-extrabold mt-2">{winners.map(team => team.name).join(' · ')}</h2>
            <p className="text-5xl font-black mt-3">{winners[0].score}</p>
            <p className="text-sm opacity-75">points</p>
          </div>
        )}

        {prizeWinners.length > 0 && (
          <div style={{ background: `${C.caution}14`, border: `1px solid ${C.caution}55` }} className="rounded-2xl p-5 mb-8">
            <p style={{ color: '#FCD34D' }} className="text-[11px] font-bold uppercase tracking-wider mb-3">Prize Winners</p>
            <div className="space-y-3">
              {prizeWinners.map(({ team, award }) => (
                <div key={`${team.id}-${award.placement}`} className="flex items-start gap-3">
                  <span style={{ color: '#FCD34D' }} className="w-20 shrink-0 text-sm font-extrabold">{award.placement}</span>
                  <div>
                    <p style={{ color: C.liveText }} className="text-sm font-bold">{team.name}</p>
                    <p style={{ color: C.liveDim }} className="text-sm">{award.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="rounded-2xl p-5 mb-8">
          <p style={{ color: C.liveDim }} className="text-[11px] font-bold uppercase tracking-wider mb-3">
            Final Standings · {playersSeeFinalLeaderboard(leaderboardVisibility) ? 'Also visible to players' : 'Host only'}
          </p>
          <div style={{ borderTop: `1px solid ${C.liveLine}` }}>
            {leaderboard.map((team, i) => (
              <div key={team.id} style={{ borderBottom: `1px solid ${C.liveLine}` }} className="flex items-center gap-3 py-3 last:border-0">
                <span style={{ color: (team.final_placement ?? i + 1) <= 3 ? C.liveText : C.liveDim }} className="w-9 text-center text-sm shrink-0 font-extrabold">{ordinalPlacement(team.final_placement ?? i + 1)}</span>
                <span style={{ color: C.liveText }} className="flex-1 text-sm font-semibold">{team.name}</span>
                <span style={{ color: C.liveText }} className="font-extrabold tabular-nums">{team.score}</span>
                {prizeAwardsFromJson(team.prize_awards).length > 0 && (
                  <span style={{ background: '#FEF3C7', color: '#92400E' }} className="rounded-full px-2 py-1 text-[10px] font-extrabold">PRIZE</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => go('recent-games')} style={{ border: `1px solid ${C.liveLine}`, color: C.liveText }} className="flex-1 cursor-pointer rounded-xl px-5 py-3.5 text-sm font-bold transition-colors hover:bg-white/5">View Game Summary</button>
          <Btn v="live" sz="lg" cls="flex-1 justify-center" onClick={finishAndReturn}>Finish &amp; Return to My Quizzes</Btn>
        </div>
        </>
        )}
      </main>
    </div>
  )
}

// ─── SCREEN NAVIGATOR (dev tool) ──────────────────────────────────────────────

const SCREENS: [Screen, string][] = [
  ['dashboard', '1 · Dashboard'],
  ['questions', '2 · Questions'],
  ['recent-games', '3 · Recent Games'],
  ['create-quiz', '4 · Create Quiz'],
  ['quiz-builder', '5 · Quiz Builder'],
  ['auto-build', '6 · Auto-Build'],
  ['quiz-review', '7 · Quiz Review'],
  ['host-setup', '8 · Host Setup'],
  ['lobby', '9 · Lobby'],
  ['live-question', '10 · Live Console'],
  ['end-of-round', '11 · End of Round'],
  ['final-results', '12 · Final Results'],
]

function ScreenNav({ current, go }: { current: Screen; go: Go }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fixed bottom-5 right-5 z-[999]">
      {open && (
        <div style={{ background: '#0C0B18ee', border: `1px solid ${C.liveLine}` }}
          className="absolute bottom-full right-0 mb-2 rounded-2xl p-2 shadow-2xl w-52 backdrop-blur">
          <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1.5">Jump to screen</p>
          <div className="space-y-0.5">
            {SCREENS.map(([s, l]) => (
              <button key={s} onClick={() => { go(s); setOpen(false) }}
                style={{
                  background: current === s ? C.violet : 'transparent',
                  color: current === s ? 'white' : C.liveDim,
                }}
                className="w-full text-left text-[11px] font-semibold px-3 py-2 rounded-xl transition-colors hover:text-white">
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)}
        style={{ background: '#0C0B18cc', border: `1px solid ${C.liveLine}` }}
        className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-xl hover:opacity-90 transition-opacity backdrop-blur">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
          <rect x="2" y="3" width="10" height="1.3" rx="0.65"/>
          <rect x="2" y="6.35" width="10" height="1.3" rx="0.65"/>
          <rect x="2" y="9.7" width="10" height="1.3" rx="0.65"/>
        </svg>
      </button>
    </div>
  )
}

// ─── APP ──────────────────────────────────────────────────────────────────────

export default function App({
  showDevNavigator = false,
  onLiveModeChange,
}: {
  showDevNavigator?: boolean
  onLiveModeChange?: (live: boolean) => void
}) {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [restoringSession, setRestoringSession] = useState(true)
  const [connectionLost, setConnectionLost] = useState(false)

  useEffect(() => {
    onLiveModeChange?.(screen === 'lobby' || screen === 'live-question' || screen === 'end-of-round')
  }, [onLiveModeChange, screen])

  useHostKeyboardShortcuts(
    !restoringSession && (screen === 'lobby' || screen === 'live-question' || screen === 'end-of-round'),
  )

  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function clearStoredGame() {
      localStorage.removeItem('simple-trivia-host-game-id')
      localStorage.removeItem('simple-trivia-host-game-code')
      localStorage.removeItem('simple-trivia-host-game-title')
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

      const gameId = localStorage.getItem('simple-trivia-host-game-id')
      const gameCode = localStorage.getItem('simple-trivia-host-game-code')
      if (!gameId && !gameCode) {
        if (active) {
          setRestoringSession(false)
          setConnectionLost(false)
        }
        return
      }

      if (!navigator.onLine) {
        if (active) setConnectionLost(true)
        retry()
        return
      }

      const { data: authData, error: authError } = await supabase.auth.getUser()
      let gameQuery = supabase
        .from('games')
        .select('id, code, title, status, current_screen, quiz_id')
      gameQuery = gameId ? gameQuery.eq('id', gameId) : gameQuery.eq('code', gameCode as string)
      const { data: game, error: gameError } = await gameQuery.maybeSingle()

      if (!active) return
      if (authError || gameError) {
        console.error('Could not restore host session:', authError ?? gameError)
        setConnectionLost(true)
        retry()
        return
      }

      if (!authData.user || !game?.quiz_id) {
        clearStoredGame()
        setScreen('dashboard')
        setRestoringSession(false)
        setConnectionLost(false)
        return
      }

      const { data: quiz, error: quizError } = await supabase
        .from('quizzes')
        .select('owner_id')
        .eq('id', game.quiz_id)
        .maybeSingle()

      if (!active) return
      if (quizError) {
        console.error('Could not verify restored host game:', quizError)
        setConnectionLost(true)
        retry()
        return
      }

      if (quiz?.owner_id !== authData.user.id) {
        clearStoredGame()
        setScreen('dashboard')
        setRestoringSession(false)
        setConnectionLost(false)
        return
      }

      localStorage.setItem('simple-trivia-host-game-id', game.id)
      localStorage.setItem('simple-trivia-host-game-code', game.code)
      localStorage.setItem('simple-trivia-host-game-title', game.title)
      setScreen(hostRecoveryScreen(game.status, game.current_screen))
      setRestoringSession(false)
      setConnectionLost(false)
    }

    const handleOffline = () => {
      if (!active || !localStorage.getItem('simple-trivia-host-game-id')) return
      setConnectionLost(true)
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

  const screens: Record<Screen, React.ReactNode> = {
    'dashboard': <Dashboard go={setScreen} />,
    'questions': <QuestionsScreen go={setScreen} />,
    'recent-games': <RecentGamesScreen go={setScreen} />,
    'create-quiz': <CreateQuiz go={setScreen} />,
    'quiz-builder': <QuizBuilder go={setScreen} />,
    'auto-build': <AutoBuild go={setScreen} />,
    'quiz-review': <QuizReview go={setScreen} />,
    'host-setup': <HostSetup go={setScreen} />,
    'lobby': <Lobby go={setScreen} />,
    'live-question': <LiveQuestion go={setScreen} />,
    'end-of-round': <EndOfRound go={setScreen} />,
    'final-results': <FinalResults go={setScreen} />,
  }

  if (restoringSession) {
    return (
      <main style={{ background: C.ground }} className="flex min-h-screen items-center justify-center px-6 text-center">
        <div>
          <div style={{ borderColor: C.line, borderTopColor: C.violet }} className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-4" />
          <h1 style={{ color: C.ink }} className="text-2xl font-extrabold">Restoring your host session…</h1>
          <p style={{ color: C.sub }} className="mt-2 text-sm">Your live game state is saved.</p>
        </div>
      </main>
    )
  }

  return (
    <div>
      {screens[screen]}
      {showDevNavigator && <ScreenNav current={screen} go={setScreen} />}
      {connectionLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#18171F]/80 px-6 text-center backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl">
            <div style={{ borderColor: C.line, borderTopColor: C.violet }} className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-4" />
            <h2 style={{ color: C.ink }} className="text-2xl font-extrabold">Trying to reconnect…</h2>
            <p style={{ color: C.sub }} className="mt-2 text-sm leading-6">Host controls are paused while we restore the latest game state.</p>
          </div>
        </div>
      )}
    </div>
  )
}
