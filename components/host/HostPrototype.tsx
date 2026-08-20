"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  asStringArray,
  gradingPoints,
  multiAnswerMissing,
  parseStoredAnswer,
  questionOptions,
  scoreSubmission,
  storedSubmissionGrading,
  type ReviewStatus,
  type SubmissionGrading,
} from "@/lib/trivia/grading";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Screen =
  | 'dashboard' | 'create-quiz' | 'quiz-builder'
  | 'auto-build' | 'quiz-review' | 'host-setup'
  | 'lobby' | 'live-question' | 'end-of-round' | 'final-results'
type Go = (s: Screen) => void

const DEMO_GAME_CODE = '728461'

function getHostGameCode() {
  if (typeof window === 'undefined') return DEMO_GAME_CODE
  return localStorage.getItem('simple-trivia-host-game-code') || DEMO_GAME_CODE
}

function getHostGameTitle() {
  if (typeof window === 'undefined') return 'Friday Night Trivia'
  return localStorage.getItem('simple-trivia-host-game-title') || 'Friday Night Trivia'
}

async function generateUniqueGameCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const { data, error } = await supabase
      .from('games')
      .select('id')
      .eq('code', code)
      .maybeSingle()

    if (error) throw error
    if (!data) return code
  }

  throw new Error('Could not generate a unique game code')
}

async function updateLiveGame(values: {
  status?: 'lobby' | 'live' | 'finished'
  current_screen?: string
  answer_phase?: 'open' | 'closed' | 'revealed'
  current_question_key?: string
}) {
  const { error } = await supabase
    .from('games')
    .update(values)
    .eq('code', getHostGameCode())

  if (error) {
    throw error
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
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
const QUIZZES = [
  { id: 1, title: 'Friday Night Trivia', rounds: 6, questions: 30, mins: 75, edited: '2 hours ago', status: 'Ready' },
  { id: 2, title: 'Pub Quiz Classics', rounds: 4, questions: 20, mins: 50, edited: 'Yesterday', status: 'Draft' },
  { id: 3, title: 'Sports Night Special', rounds: 5, questions: 25, mins: 65, edited: '3 days ago', status: 'Ready' },
  { id: 4, title: 'Music Through the Decades', rounds: 4, questions: 20, mins: 55, edited: '1 week ago', status: 'Draft' },
]


const LB = [
  { name: 'Trivia Newton John', score: 48, delta: 3 },
  { name: 'Quizteama Aguilera', score: 43, delta: 1 },
  { name: 'Risky Quizness', score: 38, delta: 0 },
  { name: 'Norfolk & Chance', score: 31, delta: -1 },
  { name: 'The Know-It-Alls', score: 28, delta: 2 },
  { name: 'Quiz Khalifa', score: 22, delta: 0 },
  { name: 'I Am Smarticus', score: 17, delta: -1 },
]

const ROUNDS = [
  { id: 1, title: 'General Knowledge', count: 5 },
  { id: 2, title: 'Movies', count: 5 },
  { id: 3, title: 'Sport', count: 5 },
  { id: 4, title: 'Music', count: 5 },
]

const Qs = [
  { id: 1, text: 'What is the capital of Canada?', cat: 'Geography', diff: 'Medium', type: 'Single Answer' },
  { id: 2, text: 'How many bones are in the adult human body?', cat: 'Science', diff: 'Hard', type: 'Single Answer' },
  { id: 3, text: 'Who painted the Mona Lisa?', cat: 'Art', diff: 'Easy', type: 'Single Answer' },
  { id: 4, text: 'In what year did the Berlin Wall fall?', cat: 'History', diff: 'Medium', type: 'Single Answer' },
  { id: 5, text: 'What is the chemical symbol for gold?', cat: 'Science', diff: 'Easy', type: 'Single Answer' },
]

// ─── BASE COMPONENTS ──────────────────────────────────────────────────────────

function Btn({
  v = 'primary', sz = 'md', children, onClick, cls = '', disabled = false,
}: {
  v?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'live'
  sz?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  children: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  cls?: string
  disabled?: boolean
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
    <button className={`${base} ${sizes[sz]} ${variants[v]} ${cls}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function Chip({
  children, color = 'default',
}: { children: React.ReactNode; color?: 'default' | 'ready' | 'draft' | 'easy' | 'medium' | 'hard' | 'violet' | 'live' }) {
  const colors: Record<string, string> = {
    default: 'bg-ground text-sub border border-line',
    ready: 'bg-go/10 text-go',
    draft: 'bg-caution/10 text-caution',
    easy: 'bg-go/10 text-go',
    medium: 'bg-caution/10 text-caution',
    hard: 'bg-stop/10 text-stop',
    violet: 'bg-violet-pale text-violet',
    live: 'bg-stop/20 text-red-400',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[color]}`}>
      {children}
    </span>
  )
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const I = {
  back: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  down: ({ r = false }: { r?: boolean }) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={r ? '-rotate-90 transition-transform' : 'transition-transform'}><path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  grip: () => <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="3.5" y="2" width="2" height="2" rx="1"/><rect x="8.5" y="2" width="2" height="2" rx="1"/><rect x="3.5" y="6" width="2" height="2" rx="1"/><rect x="8.5" y="6" width="2" height="2" rx="1"/><rect x="3.5" y="10" width="2" height="2" rx="1"/><rect x="8.5" y="10" width="2" height="2" rx="1"/></svg>,
  pencil: () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8.5 2.5l2 2L3 12H1v-2l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  refresh: () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><polyline points="12,1 12.5,4.7 9,5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
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
      className="h-14 flex items-center px-6 gap-6 sticky top-0 z-40">
      <button onClick={() => go('dashboard')} className="flex items-center gap-2.5 mr-3">
        <div style={{ background: C.violet }} className="w-7 h-7 rounded-lg flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="5" r="2.5" fill="white"/>
            <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </div>
        <span style={{ color: C.ink }} className="font-bold text-[15px] tracking-tight">Simple Trivia</span>
      </button>
      <div className="flex items-center gap-0.5 flex-1">
        {['My Quizzes', 'Question Library', 'Recent Games'].map(lbl => (
          <button
            key={lbl}
            onClick={() => go('dashboard')}
            className="relative px-3.5 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{ color: active === lbl ? C.violet : C.sub }}
          >
            {lbl}
            {active === lbl && (
              <span style={{ background: C.violet }} className="absolute bottom-0 left-3.5 right-3.5 h-0.5 rounded-full" />
            )}
          </button>
        ))}
      </div>
      <div style={{ background: C.violet }} className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-pointer hover:opacity-90 transition-opacity">
        JH
      </div>
    </nav>
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

  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <Nav go={go} active="My Quizzes" />
      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center gap-4 mb-8">
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
          <div className="flex-1" />
          <Btn onClick={() => go('create-quiz')} sz="sm">
            <I.plus /> Create Quiz
          </Btn>
        </div>

        {loadError && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA' }} className="rounded-xl px-4 py-3 mb-5">
            <p style={{ color: C.stop }} className="text-sm font-semibold">{loadError}</p>
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
          <div className="grid grid-cols-3 gap-4">
            {quizzes.map(q => <QuizCard key={q.id} q={q} go={go} />)}
            <button
              onClick={() => go('create-quiz')}
              style={{ border: `2px dashed ${C.line}` }}
              className="rounded-2xl flex flex-col items-center justify-center gap-2.5 min-h-[210px] group hover:border-violet transition-colors"
            >
              <div style={{ background: C.violetMist }} className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors group-hover:bg-violet-pale">
                <I.plus />
              </div>
              <span style={{ color: C.sub }} className="text-sm font-semibold group-hover:text-violet transition-colors">New Quiz</span>
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function QuizCard({ q, go }: { q: QuizSummary; go: Go }) {
  const ready = q.status === 'ready'

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
        <h3 style={{ color: C.ink }} className="font-bold text-[15px] leading-snug">{q.title}</h3>
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
      <div style={{ borderTop: `1px solid ${C.line}` }} className="flex items-center gap-2 pt-3.5 mt-2">
        <Btn v="ghost" sz="sm" onClick={() => selectQuiz('quiz-builder')} cls="flex-1 justify-center">Edit</Btn>
        <Btn sz="sm" onClick={() => selectQuiz('host-setup')} cls="flex-1 justify-center" disabled={!ready}>Host Game</Btn>
        <button style={{ color: C.sub }} className="p-1.5 rounded-lg hover:bg-ground transition-colors"><I.menu /></button>
      </div>
    </div>
  )
}

// ─── SCREEN 2: CREATE QUIZ ────────────────────────────────────────────────────

function CreateQuiz({ go }: { go: Go }) {
  const [sel, setSel] = useState<'scratch' | 'auto' | null>(null)
  const [n, setN] = useState(30)
  const [nInput, setNInput] = useState('30')
  const est = Math.round(n * 2.4)

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
              id: 'scratch' as const,
              icon: <I.plus />,
              title: 'Build it myself',
              desc: 'Start with an empty quiz and add your own questions, or pick from the question library.',
              cta: 'Start from scratch',
              next: 'quiz-builder' as Screen,
            },
            {
              id: 'auto' as const,
              icon: <I.star />,
              title: 'Build it for me',
              desc: "We'll assemble a quiz from our verified library. Review and change everything before saving.",
              cta: 'Build my quiz',
              next: 'auto-build' as Screen,
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
              <h3 style={{ color: C.ink }} className="font-bold text-base mb-1.5">{opt.title}</h3>
              <p style={{ color: C.sub }} className="text-sm leading-relaxed mb-5">{opt.desc}</p>
              <Btn
                v={sel === opt.id ? 'primary' : 'secondary'}
                sz="sm"
                onClick={(e) => { e.stopPropagation(); go(opt.next) }}
              >
                {opt.cta}
              </Btn>
            </div>
          ))}
        </div>

        <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-6">
          <label style={{ color: C.ink }} className="block font-bold mb-1">How many questions?</label>
          <p style={{ color: C.sub }} className="text-xs mb-4">This applies whichever route you choose above.</p>
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => { const v = Math.max(1, n - 1); setN(v); setNInput(String(v)) }}
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold hover:bg-ground transition-colors"
            >−</button>
            <input
              type="number"
              value={nInput}
              min={1}
              onChange={e => {
                setNInput(e.target.value)
                const v = parseInt(e.target.value)
                if (!isNaN(v) && v >= 1) setN(v)
              }}
              onBlur={() => { if (n < 1) { setN(1); setNInput('1') } else setNInput(String(n)) }}
              style={{ color: C.ink, border: `1px solid ${C.line}` }}
              className="text-4xl font-extrabold w-28 text-center tabular-nums bg-transparent rounded-xl px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              onClick={() => { const v = n + 1; setN(v); setNInput(String(v)) }}
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold hover:bg-ground transition-colors"
            >+</button>
            <span style={{ color: C.sub }} className="text-sm">questions</span>
          </div>
          <input type="range" min={1} max={100} step={1} value={Math.min(n, 100)} onChange={e => { const v = +e.target.value; setN(v); setNInput(String(v)) }} className="w-full mb-4" />
          <div style={{ background: C.violetMist, border: `1px solid ${C.violetPale}` }} className="rounded-xl px-4 py-3">
            <p style={{ color: C.ink }} className="text-sm font-semibold">
              Estimated running time: <span style={{ color: C.violet }}>~{est} minutes</span>
            </p>
            <p style={{ color: C.sub }} className="text-xs mt-0.5">
              Varies based on answering pace, scoring pauses, and breaks between rounds.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── SCREEN 3: QUIZ BUILDER ───────────────────────────────────────────────────

function QuizBuilder({ go }: { go: Go }) {
  const [title, setTitle] = useState('Friday Night Trivia')
  const [modal, setModal] = useState<null | 'single' | 'multi'>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      {/* Builder top bar */}
      <header style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }}
        className="h-14 flex items-center px-6 gap-4 sticky top-0 z-40">
        <button onClick={() => go('dashboard')} style={{ color: C.sub }}
          className="flex items-center gap-1.5 text-sm font-medium hover:text-violet transition-colors shrink-0">
          <I.back /> My Quizzes
        </button>
        <div className="flex-1 flex justify-center">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            style={{ color: C.ink, borderBottom: `2px solid transparent` }}
            className="text-[15px] font-bold text-center bg-transparent px-2 py-0.5 transition-colors hover:border-b-line focus:border-b-violet focus:outline-none min-w-[200px]"
          />
        </div>
        <div style={{ color: C.sub }} className="text-xs flex items-center gap-2 shrink-0">
          <span className="font-mono">20q</span>
          <span style={{ color: C.line }}>·</span>
          <span className="font-mono">4r</span>
          <span style={{ color: C.line }}>·</span>
          <span className="font-mono">~48 min</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span style={{ color: C.go }} className="flex items-center gap-1.5 text-xs font-semibold">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Saved 10s ago
          </span>
          <Btn v="secondary" sz="sm">Preview</Btn>
          <Btn sz="sm">Save Quiz</Btn>
        </div>
      </header>

      <div className="flex" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <main className="flex-1 px-6 py-7 space-y-3.5 min-w-0">
          {ROUNDS.map((r, ri) => (
            <BuilderRound
              key={r.id} round={r}
              qs={Qs.slice(0, ri === 0 ? 3 : ri === 1 ? 2 : 0)}
              showContentCard={ri === 1}
              showImageQ={ri === 0}
              onEdit={type => setModal(type)}
            />
          ))}
          <button
            style={{ border: `2px dashed ${C.line}` }}
            className="w-full py-4 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors hover:border-violet"
          >
            <span style={{ color: C.sub }} className="hover:text-violet transition-colors flex items-center gap-2">
              <I.plus /> Add Round
            </span>
          </button>
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
                  {ROUNDS.map(r => (
                    <div key={r.id} style={{ color: C.sub }}
                      className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-ground cursor-pointer transition-colors hover:text-ink text-xs">
                      <span className="truncate"><span className="font-mono opacity-60 mr-1.5">R{r.id}</span>{r.title}</span>
                      <span className="font-mono ml-1 shrink-0">{r.count}</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: `1px solid ${C.line}` }} className="mt-3 pt-3 flex justify-between text-xs">
                  <span style={{ color: C.sub }}>Total</span>
                  <span style={{ color: C.ink }} className="font-bold">20 questions</span>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {modal && <QuestionEditor type={modal} onClose={() => setModal(null)} onToggle={() => setModal(t => t === 'single' ? 'multi' : 'single')} />}
    </div>
  )
}

function BuilderRound({ round, qs, onEdit, showContentCard = false, showImageQ = false }: {
  round: typeof ROUNDS[0]; qs: typeof Qs; onEdit: (t: 'single' | 'multi') => void
  showContentCard?: boolean; showImageQ?: boolean
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
        <span style={{ color: C.sub }} className="text-xs font-mono">{round.count}q</span>
        <button onClick={() => setOpen(o => !o)} style={{ color: C.sub }} className="hover:text-ink transition-colors p-0.5">
          <I.down r={!open} />
        </button>
      </div>
      {open && (
        <div className="p-3 space-y-2">
          {showImageQ && (
            <BuilderQuestion
              q={{ id: 0, text: 'Which country does this flag belong to?', cat: 'Geography', diff: 'Easy', type: 'Single Answer' }}
              idx={0} hasImage onEdit={() => onEdit('single')}
            />
          )}
          {qs.map((q, i) => (
            <BuilderQuestion key={q.id} q={q} idx={showImageQ ? i + 1 : i} onEdit={() => onEdit(i % 2 === 0 ? 'single' : 'multi')} />
          ))}
          {showContentCard && <BuilderContentScreen />}
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

function BuilderContentScreen() {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState("Bar's open — back in 10 minutes!")
  const [body, setBody] = useState('')
  const [showImage, setShowImage] = useState(false)

  return (
    <div style={{ border: `1.5px dashed ${C.violet}50`, background: `${C.violet}06` }}
      className="rounded-xl overflow-hidden">
      {/* Header row — click anywhere to expand */}
      <div className="flex items-start gap-3 px-3 py-3 group cursor-pointer hover:bg-violet/5 transition-colors"
        onClick={() => setExpanded(v => !v)}>
        <span style={{ color: C.sub }} className="mt-0.5 cursor-grab hover:text-ink transition-colors shrink-0"
          onClick={e => e.stopPropagation()}><I.grip /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span style={{ background: C.violetPale, color: C.violet }}
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md">Content Screen</span>
            <span style={{ color: C.sub }} className="text-[10px]">Shown to players · Not scored</span>
          </div>
          <p style={{ color: C.ink }} className="text-sm font-semibold truncate group-hover:text-violet transition-colors">
            {title || 'Untitled screen'}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
          <IBtn icon={<I.trash />} title="Delete" danger />
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.violet}30`, background: `${C.violet}04` }}
          className="px-4 pb-4 pt-3 space-y-3">
          <div>
            <label style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-wider block mb-1">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Bar's open — back in 10 minutes!"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 placeholder:text-sub"
            />
          </div>
          <div>
            <label style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-wider block mb-1">Body Copy <span className="normal-case font-normal opacity-60">(optional)</span></label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={2}
              placeholder="Additional text shown below the title on player screens…"
              style={{ border: `1px solid ${C.line}`, color: C.ink }}
              className="w-full rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 resize-none placeholder:text-sub"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label style={{ color: C.sub }} className="text-[10px] font-bold uppercase tracking-wider">Image <span className="normal-case font-normal opacity-60">(optional)</span></label>
              {!showImage && (
                <button onClick={() => setShowImage(true)} style={{ color: C.violet }}
                  className="text-[11px] font-semibold hover:opacity-70">+ Add image</button>
              )}
            </div>
            {showImage && (
              <div className="flex items-center gap-2">
                <div style={{ border: `2px dashed ${C.line}` }}
                  className="flex-1 rounded-xl p-3 flex items-center gap-2 cursor-pointer hover:border-violet/40 transition-colors">
                  <svg width="16" height="16" viewBox="0 0 18 14" fill="none">
                    <rect x="1" y="1" width="16" height="12" rx="2" stroke={C.sub} strokeWidth="1.2"/>
                    <circle cx="5.5" cy="5" r="1.5" fill={C.sub} fillOpacity="0.5"/>
                    <path d="M1 10l4-4 3 3 2.5-2.5L17 12" stroke={C.sub} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ color: C.sub }} className="text-xs">Drop image or click to upload</span>
                </div>
                <button onClick={() => setShowImage(false)} style={{ color: C.sub }} className="hover:text-stop transition-colors p-1">{I.x(14)}</button>
              </div>
            )}
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

function BuilderQuestion({ q, idx, onEdit, hasImage = false }: { q: typeof Qs[0]; idx: number; onEdit: () => void; hasImage?: boolean }) {
  return (
    <div onClick={onEdit} style={{ border: `1px solid ${C.line}`, cursor: 'pointer' }}
      className="flex items-start gap-3 px-3 py-3 rounded-xl hover:border-violet hover:shadow-sm hover:bg-violet-mist/30 transition-all group bg-white">
      <span style={{ color: C.sub }} className="mt-0.5 cursor-grab hover:text-ink transition-colors shrink-0" onClick={e => e.stopPropagation()}><I.grip /></span>
      <div className="flex-1 min-w-0">
        {hasImage && (
          <div style={{ background: C.ground, border: `1px solid ${C.line}` }}
            className="rounded-lg h-16 mb-2 flex items-center justify-center gap-2 overflow-hidden">
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
              <rect x="1" y="1" width="16" height="12" rx="2" stroke={C.sub} strokeWidth="1.2"/>
              <circle cx="5.5" cy="5" r="1.5" fill={C.sub} fillOpacity="0.5"/>
              <path d="M1 10l4-4 3 3 2.5-2.5L16 12" stroke={C.sub} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ color: C.sub }} className="text-xs">flag_japan.png</span>
          </div>
        )}
        <div className="flex items-start gap-2 mb-2">
          <span style={{ color: C.sub }} className="text-[11px] font-mono shrink-0 mt-0.5">Q{idx + 1}</span>
          <p style={{ color: C.ink }} className="text-sm leading-snug group-hover:text-violet transition-colors">{q.text}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Chip>{q.cat}</Chip>
          <Chip color={q.diff === 'Easy' ? 'easy' : q.diff === 'Medium' ? 'medium' : 'hard'}>{q.diff}</Chip>
          <Chip color="violet">{q.type}</Chip>
          {hasImage && <Chip color="violet">📷 Image</Chip>}
          <span style={{ color: C.violet }} className="text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 ml-1">
            <I.pencil /> Edit
          </span>
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
        <IBtn icon={<I.refresh />} title="Replace" />
        <IBtn icon={<I.copy />} title="Duplicate" />
        <IBtn icon={<I.trash />} title="Delete" danger />
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

function QuestionEditor({ type: initialType, onClose }: { type: 'single' | 'multi'; onClose: () => void; onToggle: () => void }) {
  const [qtype, setQtype] = useState<QType>(initialType === 'multi' ? 'multiple-choice' : 'single')
  const [pendingType, setPendingType] = useState<QType | null>(null)
  const [diff, setDiff] = useState<'Easy' | 'Medium' | 'Hard' | null>('Medium')
  const [cat, setCat] = useState('Geography')
  const [showCat, setShowCat] = useState(true)
  const [showDiff, setShowDiff] = useState(true)
  const [showTags, setShowTags] = useState(false)
  const [alternates, setAlternates] = useState(['ACT', 'Australian Capital Territory'])
  const [multiAnswers, setMultiAnswers] = useState([
    { text: 'Poland', alts: [] as string[] },
    { text: 'Czech Republic', alts: ['Czechia'] as string[] },
    { text: 'Austria', alts: [] as string[] },
  ])
  const [scoring, setScoring] = useState<'each' | 'all'>('each')
  const [parts, setParts] = useState([
    { label: 'A', text: 'Gold Rings, Red Star Rings and Emerald Gems', ans: 'Sonic the Hedgehog', alts: [] as string[] },
    { label: 'B', text: 'Wumpa Fruit, Coloured Gems and Time Relics', ans: 'Crash Bandicoot', alts: [] as string[] },
    { label: 'C', text: 'Musical Notes, Red and Gold Feathers, and Blue Eggs', ans: "Banjo-Kazooie", alts: [] as string[] },
  ])

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

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div style={{ background: 'rgba(12,11,24,0.4)' }} className="absolute inset-0 backdrop-blur-[2px]" onClick={onClose} />
      <div style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }}
        className="relative w-[500px] flex flex-col shadow-2xl">

        {/* Header */}
        <div style={{ borderBottom: `1px solid ${C.line}` }} className="flex items-center px-6 py-4 shrink-0">
          <h2 style={{ color: C.ink }} className="font-extrabold flex-1">Edit Question</h2>
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
                defaultValue={
                  qtype === 'single' ? 'What is the capital city of Australia?' :
                  qtype === 'multi-answer' ? 'Name the three countries that share a land border with Germany to the east.' :
                  qtype === 'multiple-choice' ? 'Which film won the Academy Award for Best Picture in 2020?' :
                  qtype === 'multi-part' ? 'Like the Coins and Mushrooms from the Super Mario series, identify the video game franchise from their collectible items:' :
                  'Rank these four planets in order of size, largest first.'
                }
                rows={3}
                style={{ border: `1px solid ${C.line}`, color: C.ink }}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 resize-none leading-relaxed"
              />
            </Field>

            {/* ── Single Answer ── */}
            {qtype === 'single' && (
              <>
                <Field label="Correct Answer">
                  <input defaultValue="Canberra"
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
                  {[
                    { l: 'A', text: 'Parasite', correct: true },
                    { l: 'B', text: '1917', correct: false },
                    { l: 'C', text: 'Joker', correct: false },
                    { l: 'D', text: 'Once Upon a Time in Hollywood', correct: false },
                  ].map(opt => (
                    <div key={opt.l}
                      style={{ border: `1.5px solid ${opt.correct ? C.go : C.line}`, background: opt.correct ? '#f0fdf9' : C.ground }}
                      className="flex items-center gap-3 p-3 rounded-xl">
                      <div style={{ background: opt.correct ? C.go : C.line }}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">
                        {opt.l}
                      </div>
                      <input defaultValue={opt.text} style={{ color: C.ink }} className="flex-1 bg-transparent text-sm focus:outline-none" />
                      {opt.correct && <span style={{ color: C.go }} className="text-xs font-bold shrink-0">✓ Correct</span>}
                    </div>
                  ))}
                  <button style={{ color: C.violet }} className="text-xs font-semibold hover:underline flex items-center gap-1">
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
                    {['Jupiter', 'Saturn', 'Uranus', 'Neptune'].map((item, i) => (
                      <div key={i} style={{ border: `1px solid ${C.line}`, background: C.ground }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                        <span style={{ color: C.sub }} className="cursor-grab"><I.grip /></span>
                        <span style={{ background: C.violetPale, color: C.violet }}
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0">{i + 1}</span>
                        <input defaultValue={item} style={{ color: C.ink }} className="flex-1 bg-transparent text-sm focus:outline-none" />
                      </div>
                    ))}
                    <button style={{ color: C.violet }} className="text-xs font-semibold hover:underline flex items-center gap-1">
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

            <OptionalField label="Category (Optional)" shown={showCat} onToggle={() => { setShowCat(v => !v); setCat('') }}>
              {showCat && (
                <input value={cat} onChange={e => setCat(e.target.value)}
                  style={{ border: `1px solid ${C.line}`, color: C.ink }}
                  className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30" />
              )}
            </OptionalField>

            <OptionalField label="Difficulty (Optional)" shown={showDiff} onToggle={() => { setShowDiff(v => !v); setDiff(null) }}>
              {showDiff && (
                <div className="flex gap-2">
                  {(['Easy', 'Medium', 'Hard'] as const).map(d => (
                    <button key={d} onClick={() => setDiff(d)}
                      style={{
                        border: `1.5px solid ${diff === d ? (d === 'Easy' ? C.go : d === 'Medium' ? C.caution : C.stop) : C.line}`,
                        background: diff === d ? (d === 'Easy' ? '#f0fdf9' : d === 'Medium' ? '#fffbeb' : '#fef2f2') : 'white',
                        color: diff === d ? (d === 'Easy' ? C.go : d === 'Medium' ? C.caution : C.stop) : C.sub,
                      }}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all">{d}
                    </button>
                  ))}
                </div>
              )}
            </OptionalField>

            <OptionalField label="Tags (Optional)" shown={showTags} onToggle={() => setShowTags(v => !v)}>
              {showTags && (
                <>
                  <input defaultValue="Capitals, Countries"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30"
                    placeholder="e.g. Countries, Cities, Capitals…" />
                  <p style={{ color: C.sub }} className="text-[11px] mt-1.5 opacity-70">Comma-separated. More specific than category — used for filtering and auto-build targeting.</p>
                </>
              )}
            </OptionalField>

            <Field label="Host Notes">
              <textarea rows={3} placeholder="Optional facts, clarifications, or notes to read while announcing the answer."
                style={{ border: `1px solid ${C.line}`, color: C.ink }}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30 resize-none placeholder:text-sub" />
            </Field>

            <Field label="Image (Optional)">
              <div style={{ border: `2px dashed ${C.line}` }}
                className="rounded-xl p-6 flex flex-col items-center gap-2 hover:border-violet/40 hover:bg-violet-mist transition-all cursor-pointer">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect x="2" y="2" width="18" height="18" rx="3" stroke={C.sub} strokeWidth="1.4"/>
                  <circle cx="7.5" cy="7.5" r="1.5" stroke={C.sub} strokeWidth="1.3"/>
                  <path d="M2 15l5-5 3.5 3.5 3-3 6.5 6.5" stroke={C.sub} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ color: C.sub }} className="text-sm font-medium">Drop image or click to upload</span>
                <span style={{ color: C.sub }} className="text-xs opacity-60">PNG, JPG up to 5 MB</span>
              </div>
            </Field>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${C.line}` }} className="flex justify-end gap-2 px-6 py-4 shrink-0">
          <Btn v="secondary" sz="sm" onClick={onClose}>Cancel</Btn>
          <Btn sz="sm" onClick={onClose} disabled={blocked}>Save Question</Btn>
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 5: AUTO-BUILD ─────────────────────────────────────────────────────

function AutoBuild({ go }: { go: Go }) {
  const [mode, setMode] = useState<'mixed' | 'custom'>('mixed')
  const [diff, setDiff] = useState<[number, number]>([1, 3])
  const diffLabels = ['Super-Easy', 'Easy', 'Medium', 'Hard', 'Super-Hard']
  const topics = ['General Knowledge', 'Movies', 'Sport', 'Music']
  const allTopics = ['General Knowledge', 'Movies', 'Sport', 'Music', 'Geography', 'Science', 'History', 'Technology', 'Mixed']

  const diffText = () => {
    const [lo, hi] = diff
    return lo === hi ? `${diffLabels[lo]} only` : `${diffLabels[lo]} through ${diffLabels[hi]}`
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
          {/* Count */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5">
            <div className="grid grid-cols-2 gap-6">
              {[{ label: 'Questions', val: 30 }, { label: 'Rounds', val: 4 }].map(f => (
                <div key={f.label}>
                  <label style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider block mb-2">{f.label}</label>
                  <div className="flex items-baseline gap-1.5">
                    <span style={{ color: C.ink }} className="text-3xl font-extrabold tabular-nums">{f.val}</span>
                    <span style={{ color: C.sub }} className="text-sm">{f.label.toLowerCase()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Topics */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5">
            <label style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider block mb-3">Topics</label>
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
                    <select defaultValue={t} style={{ border: `1px solid ${C.line}`, color: C.ink }}
                      className="flex-1 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet/30">
                      {allTopics.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Difficulty range */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5">
            <label style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider block mb-4">Difficulty Range</label>
            {/* Dual-handle slider */}
            <div className="relative mb-5" style={{ paddingBottom: 4 }}>
              {/* Track */}
              <div style={{ background: C.line, height: 6 }} className="w-full rounded-full relative">
                {/* Filled range */}
                <div style={{
                  position: 'absolute',
                  left: `${(diff[0] / 4) * 100}%`,
                  right: `${((4 - diff[1]) / 4) * 100}%`,
                  height: '100%',
                  background: C.violet,
                  borderRadius: 4,
                }} />
              </div>
              {/* Two range inputs stacked */}
              <input type="range" min={0} max={4} step={1} value={diff[0]}
                onChange={e => { const v = Math.min(+e.target.value, diff[1]); setDiff([v, diff[1]]) }}
                className="absolute inset-0 w-full opacity-0 cursor-pointer" style={{ height: 6, top: 0 }} />
              <input type="range" min={0} max={4} step={1} value={diff[1]}
                onChange={e => { const v = Math.max(+e.target.value, diff[0]); setDiff([diff[0], v]) }}
                className="absolute inset-0 w-full opacity-0 cursor-pointer" style={{ height: 6, top: 0 }} />
              {/* Thumb dots */}
              {[0, 1].map(hi => (
                <div key={hi} style={{
                  position: 'absolute',
                  left: `calc(${(diff[hi] / 4) * 100}% - 10px)`,
                  top: -7,
                  width: 20, height: 20,
                  background: 'white',
                  border: `2px solid ${C.violet}`,
                  borderRadius: '50%',
                  pointerEvents: 'none',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                }} />
              ))}
            </div>
            {/* Labels */}
            <div className="flex justify-between mb-3">
              {diffLabels.map((l, i) => (
                <span key={l} style={{
                  color: i >= diff[0] && i <= diff[1] ? C.violet : C.sub,
                  fontWeight: (i === diff[0] || i === diff[1]) ? 700 : 400,
                }} className="text-[11px] text-center w-[18%]">{l}</span>
              ))}
            </div>
            <p style={{ color: C.sub }} className="text-sm">
              Sourcing: <span style={{ color: C.ink }} className="font-semibold">{diffText()}</span>
            </p>
          </div>

          <Btn sz="lg" cls="w-full" onClick={() => go('quiz-review')}>Generate Quiz →</Btn>
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

      {modal && <QuestionEditor type={modal} onClose={() => setModal(null)} onToggle={() => setModal(t => t === 'single' ? 'multi' : 'single')} />}
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
          <Chip color={item.diff === 'Easy' ? 'easy' : item.diff === 'Medium' ? 'medium' : 'hard'}>{item.diff}</Chip>
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
  const [lb, setLb] = useState<'always' | 'round' | 'final' | 'host'>('round')
  type PrizePlace = { enabled: boolean; msg: string }
  const topPlaces = ['1st', '2nd', '3rd']
  const bottomPlaces = ['Last', '2nd Last', '3rd Last']
  const initPrize = (msg = ''): PrizePlace => ({ enabled: false, msg })
  const [topPrizes, setTopPrizes] = useState<PrizePlace[]>([
    { enabled: true, msg: "You've won a $100 venue voucher!" },
    initPrize(), initPrize(),
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
      const { data: questionRows, error: questionError } = await supabase
        .from('quiz_questions')
        .select('question_key, position, round_number, round_position, round_question_count, round_title, prompt, category, difficulty, question_type, correct_answer, options, image_url, points_max, notes')
        .eq('quiz_id', quiz.id)
        .order('position', { ascending: true })

      if (questionError) throw questionError
      if (!questionRows || questionRows.length === 0) throw new Error('This quiz has no questions yet')

      const code = await generateUniqueGameCode()
      const firstQuestionKey = questionRows[0].question_key

      const { data: game, error: gameError } = await supabase
        .from('games')
        .insert({
          code,
          title: quiz.title,
          status: 'lobby',
          current_screen: 'lobby',
          answer_phase: 'open',
          current_question_key: firstQuestionKey,
          quiz_id: quiz.id,
          settings: {
            answer_reveal: reveal,
            leaderboard_visibility: lb,
            top_prizes: topPrizes,
            bottom_prizes: botPrizes,
          },
        })
        .select('id, code, title')
        .single()

      if (gameError) throw gameError

      const gameQuestions = questionRows.map((question) => ({
        game_id: game.id,
        question_key: question.question_key,
        position: question.position,
        round_number: question.round_number,
        round_position: question.round_position,
        round_question_count: question.round_question_count,
        round_title: question.round_title,
        prompt: question.prompt,
        category: question.category,
        difficulty: question.difficulty,
        question_type: question.question_type,
        correct_answer: question.correct_answer,
        options: question.options,
        image_url: question.image_url,
        points_max: question.points_max,
        notes: question.notes,
      }))

      const { error: copyError } = await supabase
        .from('game_questions')
        .insert(gameQuestions)

      if (copyError) {
        await supabase.from('games').delete().eq('id', game.id)
        throw copyError
      }

      localStorage.setItem('simple-trivia-host-game-id', game.id)
      localStorage.setItem('simple-trivia-host-game-code', game.code)
      localStorage.setItem('simple-trivia-host-game-title', game.title)
      go('lobby')
    } catch (error) {
      console.error('Could not open lobby:', error)
      setSetupError(error instanceof Error ? error.message : 'Could not open the lobby.')
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
                { v: 'always' as const, l: 'Always show' },
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
  const [teams, setTeams] = useState<LobbyTeam[]>([])
  const [lobbyError, setLobbyError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

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
        current_question_key: firstQuestion.question_key,
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
        .select("id")
        .eq("code", lobbyCode)
        .maybeSingle()

      if (!active) return

      if (gameError || !game) {
        console.error("Could not find lobby game:", gameError)
        setLobbyError("Could not load this lobby.")
        return
      }

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
          <div style={{ background: C.violet }} className="w-6 h-6 rounded-md flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="5" r="2.5" fill="white"/>
              <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ color: C.ink }} className="font-bold text-sm">Simple Trivia</span>
        </div>
        <div className="flex-1" />
        <Chip color="ready">
          <span style={{ background: C.go }} className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" />
          Lobby Open
        </Chip>
        <Btn v="ghost" sz="sm" onClick={() => go('host-setup')}>Settings</Btn>
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
            {/* QR Placeholder */}
            <div style={{ background: C.ground, border: `1px solid ${C.line}` }}
              className="w-44 h-44 rounded-2xl mb-6 flex items-center justify-center overflow-hidden">
              <div className="grid gap-[2.5px] p-3" style={{ gridTemplateColumns: 'repeat(9, 1fr)' }}>
                {Array.from({ length: 81 }).map((_, i) => {
                  const filled = [0,1,2,3,4,5,6,9,15,18,24,27,33,36,37,38,39,40,41,42,44,46,48,54,57,63,66,72,73,74,75,76,77,78,10,12,20,22,58,60,68,70,79,80,7,8,14,71].includes(i)
                  return <div key={i} style={{ background: filled ? C.ink : 'transparent', width: 11, height: 11, borderRadius: 1 }} />
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <Btn v="secondary" sz="sm">Display QR</Btn>
              <Btn v="secondary" sz="sm">Download QR</Btn>
            </div>
          </div>

          {/* Teams */}
          <div>
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
            <Btn sz="lg" cls="w-full" onClick={handleStartQuiz} disabled={starting || teams.length === 0}>
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
}

type LiveSubmission = {
  id: string
  team_id: string
  answer_text: string
  is_correct: boolean | null
  points_awarded: number
  grading_json: SubmissionGrading | null
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
  question_type: string
  correct_answer: unknown
  options: unknown
  image_url: string | null
  points_max: number
  notes: string | null
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
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onCorrect}
          style={{ background: C.go, color: 'white' }}
          className="px-2 py-1 rounded-md text-[10px] font-extrabold hover:opacity-90"
          title="Mark correct"
        >
          ✓
        </button>
        <button
          onClick={onIncorrect}
          style={{ background: C.stop, color: 'white' }}
          className="px-2 py-1 rounded-md text-[10px] font-extrabold hover:opacity-90"
          title="Mark incorrect"
        >
          ✕
        </button>
      </div>
    )
  }

  const correct = status === 'correct'

  return (
    <button
      onClick={correct ? onIncorrect : onCorrect}
      disabled={disabled}
      style={{
        background: correct ? `${C.go}25` : `${C.stop}20`,
        color: correct ? C.go : C.stop,
        border: `1px solid ${correct ? `${C.go}45` : `${C.stop}40`}`,
      }}
      className="min-w-[78px] flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-extrabold disabled:cursor-default hover:opacity-80 disabled:hover:opacity-100"
      title={disabled ? undefined : correct ? 'Click to mark incorrect' : 'Click to mark correct'}
    >
      <span>{correct ? '✓' : '✕'}</span>
      <span>{correct ? 'Correct' : 'Incorrect'}</span>
    </button>
  )
}
function LiveQuestion({ go }: { go: Go }) {
  const [phase, setPhase] = useState<'open' | 'closed' | 'revealed'>('open')
  const [gameScreen, setGameScreen] = useState('round-start')
  const [emergency, setEmergency] = useState(false)
  const [liveGameId, setLiveGameId] = useState<string | null>(null)
  const [teams, setTeams] = useState<LiveTeam[]>([])
  const [submissions, setSubmissions] = useState<LiveSubmission[]>([])
  const [question, setQuestion] = useState<LiveQuestionDefinition | null>(null)
  const [allQuestions, setAllQuestions] = useState<LiveQuestionDefinition[]>([])
  const [liveError, setLiveError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function loadLiveData() {
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('id, answer_phase, current_question_key, current_screen')
        .eq('code', getHostGameCode())
        .maybeSingle()

      if (!active) return

      if (gameError || !game) {
        console.error('Could not load live game:', gameError)
        setLiveError('Could not load the live game.')
        return
      }

      setLiveGameId(game.id)
      setGameScreen(game.current_screen ?? '')

      if (game.answer_phase === 'open' || game.answer_phase === 'closed' || game.answer_phase === 'revealed') {
        setPhase(game.answer_phase)
      }

      const [{ data: questionRows, error: questionError }, { data: teamRows, error: teamError }] = await Promise.all([
        supabase
          .from('game_questions')
          .select('question_key, position, round_number, round_position, round_question_count, round_title, prompt, category, difficulty, question_type, correct_answer, options, image_url, points_max, notes')
          .eq('game_id', game.id)
          .order('position', { ascending: true }),
        supabase
          .from('teams')
          .select('id, name, score')
          .eq('game_id', game.id)
          .order('created_at', { ascending: true }),
      ])

      if (!active) return

      if (questionError || teamError) {
        console.error('Could not load live question data:', questionError ?? teamError)
        setLiveError('Could not load the live question.')
        return
      }

      const questions = (questionRows ?? []) as LiveQuestionDefinition[]
      const currentQuestion = questions.find(item => item.question_key === game.current_question_key) ?? questions[0] ?? null

      setAllQuestions(questions)
      setQuestion(currentQuestion)
      setTeams((teamRows ?? []) as LiveTeam[])

      if (currentQuestion) {
        const { data: submissionRows, error: submissionError } = await supabase
          .from('submissions')
          .select('id, team_id, answer_text, is_correct, points_awarded, grading_json')
          .eq('game_id', game.id)
          .eq('question_key', currentQuestion.question_key)
          .order('created_at', { ascending: true })

        if (!active) return

        if (submissionError) {
          console.error('Could not load team answers:', submissionError)
          setLiveError('Could not load team answers.')
          return
        }

        setSubmissions((submissionRows ?? []) as LiveSubmission[])
      } else {
        setSubmissions([])
      }

      setLiveError(null)

      if (!channel) {
        channel = supabase
          .channel(`host-live-question-${game.id}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'submissions', filter: `game_id=eq.${game.id}` },
            () => { void loadLiveData() },
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'teams', filter: `game_id=eq.${game.id}` },
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

  async function handleOpenQuestion() {
    if (!question || actionBusy) return
    setActionBusy(true)
    setLiveError(null)

    try {
      await updateLiveGame({
        status: 'live',
        current_screen: question.question_type,
        answer_phase: 'open',
        current_question_key: question.question_key,
      })
      setGameScreen(question.question_type)
      setPhase('open')
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

  async function handleReopenAnswers() {
    if (!liveGameId || actionBusy || phase !== 'closed') return
    setActionBusy(true)
    setLiveError(null)

    const { error } = await supabase
      .from('games')
      .update({ answer_phase: 'open' })
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

  async function handleRevealAnswer() {
    if (!liveGameId || !question || actionBusy || reviewCount > 0) return
    setActionBusy(true)
    setLiveError(null)

    try {
      const [{ data: freshTeams, error: teamError }, { data: freshSubmissions, error: submissionError }] = await Promise.all([
        supabase.from('teams').select('id, score').eq('game_id', liveGameId),
        supabase
          .from('submissions')
          .select('id, team_id, answer_text, is_correct, points_awarded, grading_json')
          .eq('game_id', liveGameId)
          .eq('question_key', question.question_key),
      ])

      if (teamError || submissionError) throw teamError ?? submissionError

      const scoreByTeam = new Map<string, number>(
        ((freshTeams ?? []) as { id: string; score: number }[]).map(team => [team.id, team.score]),
      )

      for (const submission of (freshSubmissions ?? []) as LiveSubmission[]) {
        if (submission.is_correct !== null) continue

        const result = scoreSubmission(question, submission)
        const fullyCorrect = result.points === result.max

        const { error: markError } = await supabase
          .from('submissions')
          .update({ is_correct: fullyCorrect, points_awarded: result.points, grading_json: result.grading })
          .eq('id', submission.id)

        if (markError) throw markError

        if (result.points > 0) {
          const currentScore = scoreByTeam.get(submission.team_id) ?? 0
          const { error: scoreError } = await supabase
            .from('teams')
            .update({ score: currentScore + result.points })
            .eq('id', submission.team_id)

          if (scoreError) throw scoreError
          scoreByTeam.set(submission.team_id, currentScore + result.points)
        }
      }

      const { error: phaseError } = await supabase
        .from('games')
        .update({ answer_phase: 'revealed' })
        .eq('id', liveGameId)

      if (phaseError) throw phaseError
      setPhase('revealed')
    } catch (error) {
      console.error('Could not reveal answer:', error)
      setLiveError('Could not reveal and score the answer. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleAdvance() {
    if (!question || actionBusy) return
    setActionBusy(true)
    setLiveError(null)

    try {
      const nextQuestion = allQuestions.find(item => item.position > question.position) ?? null

      if (!nextQuestion) {
        await updateLiveGame({
          status: 'finished',
          current_screen: 'final-result',
          answer_phase: 'revealed',
          current_question_key: question.question_key,
        })
        go('final-results')
        return
      }

      if (nextQuestion.round_number !== question.round_number) {
        await updateLiveGame({
          current_screen: 'round-results',
          answer_phase: 'closed',
          current_question_key: question.question_key,
        })
        go('end-of-round')
        return
      }

      await updateLiveGame({
        current_screen: nextQuestion.question_type,
        answer_phase: 'open',
        current_question_key: nextQuestion.question_key,
      })
      setQuestion(nextQuestion)
      setPhase('open')
      setGameScreen(nextQuestion.question_type)
      setSubmissions([])
    } catch (error) {
      console.error('Could not advance the game:', error)
      setLiveError('Could not advance the game. Please try again.')
    } finally {
      setActionBusy(false)
    }
  }

  const submissionByTeam = new Map<string, LiveSubmission>(submissions.map(submission => [submission.team_id, submission] as const))
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
  const reviewCount = answerRows.reduce(
    (total, row) => total + (row.grading?.items.filter(item => item.status === 'review').length ?? 0),
    0,
  )
  const leaderboard = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const totalRounds = Math.max(1, ...allQuestions.map(item => item.round_number))
  const nextQuestion = question ? allQuestions.find(item => item.position > question.position) ?? null : null
  const nextIsNewRound = !!question && !!nextQuestion && nextQuestion.round_number !== question.round_number
  const isFinalQuestion = !!question && !nextQuestion
  const correctDisplay = correctAnswerDisplay(question)
  const questionDetails = hostQuestionDetails(question)
  const compoundQuestion = question?.question_type === 'multi-answer'
    || question?.question_type === 'multi-part'
    || question?.question_type === 'ranking'

  return (
    <div style={{ background: C.liveBg, color: C.liveText }} className="min-h-[100dvh] flex flex-col">
      <header style={{ background: C.liveSurface, borderBottom: `1px solid ${C.liveLine}`, height: 52 }}
        className="flex items-center px-6 gap-4 shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-2 shrink-0">
          <div style={{ background: C.violet }} className="w-6 h-6 rounded-md flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="5" r="2.5" fill="white"/>
              <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ color: C.liveDim }} className="font-bold text-sm">Simple Trivia</span>
        </div>
        <div className="flex-1 flex items-center justify-center gap-4 text-sm">
          <span style={{ color: C.liveDim }}>Round {question?.round_number ?? 1} of {totalRounds}</span>
          <span style={{ color: C.liveLine }}>·</span>
          <span style={{ color: C.liveText }} className="font-bold">
            Question {question?.round_position ?? 1} of {question?.round_question_count ?? 1}
          </span>
          <span style={{ color: C.liveLine }}>·</span>
          <span style={{ color: C.liveDim }}>{question?.round_title ?? 'Friday Night Trivia'}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative">
            <button onClick={() => setEmergency(e => !e)}
              style={{ border: `1px solid ${C.liveLine}`, color: C.liveDim }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:border-caution hover:text-caution transition-colors">
              Controls
            </button>
            {emergency && (
              <div style={{ background: C.livePanel, border: `1px solid ${C.liveLine}`, right: 0, top: '100%', marginTop: 6, width: 200, zIndex: 50 }}
                className="absolute rounded-xl shadow-2xl p-2 space-y-0.5">
                <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest px-2 py-1">Game Controls</p>
                {['Pause Game', 'Reopen Answers', 'Go Back to Previous'].map(label => (
                  <button key={label} onClick={() => setEmergency(false)} style={{ color: C.liveText }}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-live-surface transition-colors text-left">
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span style={{ background: '#DC2626' }} className="w-2 h-2 rounded-full animate-pulse" />
          <span style={{ color: C.liveDim }} className="text-xs font-semibold">LIVE</span>
        </div>
      </header>

      <div className="flex flex-1 items-start min-h-0">
        <div className="flex-1 flex flex-col px-7 py-6 gap-5 min-w-0 pb-12">
          <div style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="rounded-2xl p-6 shrink-0">
            <p style={{ color: C.liveDim }} className="text-[11px] font-bold uppercase tracking-widest mb-3">
              {(question?.category ?? 'General')} · {question?.difficulty ?? '—'} · {question?.points_max ?? 1} pts max
            </p>

            {question?.image_url && (
              <div style={{ background: '#fff', borderRadius: 16 }} className="h-36 mb-5 flex items-center justify-center overflow-hidden">
                <img src={question.image_url} alt="Question image" className="max-h-28 max-w-[80%] object-contain" />
              </div>
            )}

            <p style={{ color: C.liveText }} className="text-3xl font-extrabold leading-snug mb-5">
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
                  <p style={{ color: `${C.violet}99` }} className="text-[10px] font-bold uppercase tracking-widest">
                    {question?.question_type === 'multi-part' ? 'Question parts + answers · Host only' : 'Correct Answer · Host only'}
                  </p>
                  {question?.question_type === 'multi-part' ? (
                    <div className="mt-2 space-y-2.5">
                      {questionDetails.map((detail, index) => {
                        const answer = asStringArray(question.correct_answer)[index] ?? ''
                        return (
                          <div
                            key={`${detail.label}-${detail.text}`}
                            className="grid items-start gap-3"
                            style={{ gridTemplateColumns: '26px minmax(0, 1fr) auto' }}
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

                            <span style={{ color: C.violet }} className="text-sm font-extrabold whitespace-nowrap pt-0.5">
                              → {answer}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ) : question?.question_type === 'multi-answer' ? (
                    <div className="mt-1 space-y-1">
                      {asStringArray(question.correct_answer).map((answer) => (
                        <p key={answer} style={{ color: C.violet }} className="text-lg font-extrabold">
                          {answer}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: C.violet }} className="text-lg font-extrabold mt-0.5">{correctDisplay}</p>
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
                    <div className="mt-2 space-y-2.5">
                      {questionDetails.map((detail, index) => {
                        const answer = asStringArray(question.correct_answer)[index] ?? ''
                        return (
                          <div
                            key={`${detail.label}-${detail.text}`}
                            className="grid items-start gap-3"
                            style={{ gridTemplateColumns: '26px minmax(0, 1fr) auto' }}
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

                            <span style={{ color: C.go }} className="text-sm font-extrabold whitespace-nowrap pt-0.5">
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
          </div>

          <div style={{
            background: gameScreen === 'round-start' ? `${C.caution}20` : phase === 'open' ? `${C.violet}20` : phase === 'closed' ? `${C.caution}20` : `${C.go}20`,
            border: `1px solid ${gameScreen === 'round-start' ? `${C.caution}40` : phase === 'open' ? `${C.violet}40` : phase === 'closed' ? `${C.caution}40` : `${C.go}40`}`,
            color: gameScreen === 'round-start' ? C.caution : phase === 'open' ? C.violet : phase === 'closed' ? C.caution : C.go,
          }} className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-extrabold uppercase tracking-widest shrink-0">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'currentColor' }} />
            {gameScreen === 'round-start' ? 'Players are on the round intro' : phase === 'open' ? 'Accepting Answers' : phase === 'closed' ? 'Answers Closed' : 'Answer Revealed'}
          </div>

          {liveError && (
            <div style={{ background: `${C.stop}18`, border: `1px solid ${C.stop}45`, color: '#FCA5A5' }} className="rounded-xl px-4 py-3 text-sm font-semibold">
              {liveError}
            </div>
          )}

          <div className="flex items-center justify-between shrink-0">
            <h3 style={{ color: C.liveText }} className="font-bold text-sm">Team Answers</h3>
            <div className="flex items-center gap-3">
              {reviewCount > 0 && (
                <span
                  style={{ background: `${C.caution}25`, color: C.caution, border: `1px solid ${C.caution}45` }}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold"
                >
                  {reviewCount} need{reviewCount === 1 ? 's' : ''} review
                </span>
              )}
              <div style={{ background: C.liveLine }} className="h-1.5 w-32 rounded-full overflow-hidden">
                <div style={{ width: `${teams.length ? (answeredCount / teams.length) * 100 : 0}%`, background: C.violet }} className="h-full rounded-full" />
              </div>
              <span style={{ color: C.liveText }} className="text-sm font-bold tabular-nums">{answeredCount} / {teams.length}</span>
              <span style={{ color: C.liveDim }} className="text-xs">answered</span>
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
          <span>Their answer</span>
          <span className="text-right">Status</span>
        </div>

        {answerRows.map(({ team, submission, grading }) => {
          const waiting = !submission
          const item = grading?.items[0] ?? null
          const needsReview = item?.status === 'review'
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
                style={{ color: waiting ? `${C.liveText}45` : needsReview ? C.liveText : `${C.liveText}85` }}
                className={`text-sm truncate ${needsReview ? 'font-bold' : 'font-medium'}`}
              >
                {team.name}
              </span>

              <div className="min-w-0 flex items-center gap-2">
                <span
                  style={{
                    color: waiting
                      ? C.liveDim
                      : submittedIsCorrect
                        ? C.go
                        : `${C.liveText}85`,
                  }}
                  className={`text-sm italic truncate ${submittedIsCorrect ? 'font-extrabold' : 'font-semibold'}`}
                >
                  {waiting ? 'Waiting…' : item?.submitted || submissionDisplay(question, submission.answer_text)}
                </span>
                {!waiting && item?.expected && item.status !== 'correct' && (
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
              </div>

              <div className="flex items-center justify-end">
                {waiting || !item || !submission ? (
                  <span style={{ color: C.liveDim }} className="text-xs">—</span>
                ) : (
                  <ReviewBadge
                    status={item.status}
                    disabled={phase === 'revealed'}
                    onCorrect={() => { void handleReviewItem(submission.id, 0, 'correct') }}
                    onIncorrect={() => { void handleReviewItem(submission.id, 0, 'incorrect') }}
                  />
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
          const hasReview = items.some(item => item.status === 'review')
          const score = grading ? gradingPoints(grading, question?.points_max ?? 1) : 0
          const max = question?.points_max ?? Math.max(1, items.length)

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
                style={{ color: waiting ? `${C.liveText}45` : hasReview ? C.liveText : `${C.liveText}85` }}
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
                          ? 'minmax(0, 1fr) 84px'
                          : '24px minmax(0, 1fr) 84px',
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
              </div>

              <div className="text-right pt-1">
                {waiting ? (
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
                <div key={team.id} style={{ background: i === 0 ? `${C.violet}20` : 'transparent' }} className="flex items-center gap-3 p-2.5 rounded-xl">
                  <div style={{ background: i === 0 ? C.violet : C.liveLine, color: i === 0 ? 'white' : C.liveDim, width: 24, height: 24 }}
                    className="rounded-full flex items-center justify-center text-xs font-bold shrink-0 tabular-nums">{i + 1}</div>
                  <span style={{ color: i === 0 ? C.liveText : `${C.liveText}99` }} className={`text-sm flex-1 truncate ${i === 0 ? 'font-bold' : 'font-medium'}`}>{team.name}</span>
                  <span style={{ color: i === 0 ? C.liveText : `${C.liveText}99` }} className="text-sm font-bold tabular-nums">{team.score}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.liveLine}` }} className="p-5 shrink-0">
            {gameScreen === 'round-start' ? (
              <div className="space-y-3">
                <p style={{ color: C.caution }} className="text-[11px] text-center font-semibold uppercase tracking-widest">Round intro is on player phones</p>
                <button onClick={handleOpenQuestion} disabled={actionBusy || !question}
                  style={{ background: C.violet, color: 'white', boxShadow: `0 8px 32px ${C.violet}60` }}
                  className="w-full py-6 rounded-2xl text-xl font-extrabold hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50">
                  {actionBusy ? 'Opening…' : 'Open First Question'}
                </button>
              </div>
            ) : phase === 'open' ? (
              <div className="space-y-3">
                <p style={{ color: C.caution }} className="text-[11px] text-center font-extrabold uppercase tracking-widest">
                  Accepting answers · {answeredCount}/{teams.length} submitted
                </p>
                <button
                  onClick={handleCloseAnswers}
                  disabled={actionBusy}
                  style={{
                    background: '#F59E0B',
                    color: '#17130A',
                    border: '2px solid #FBBF24',
                    boxShadow: '0 10px 34px rgba(245,158,11,0.32)',
                  }}
                  className="w-full py-6 rounded-2xl text-xl font-black hover:brightness-110 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {actionBusy ? 'Closing…' : 'Close Answers'}
                  {!actionBusy && (
                    <span className="block text-xs font-bold opacity-70 mt-1">Stop all new submissions</span>
                  )}
                </button>
              </div>
            ) : phase === 'closed' ? (
              <div className="space-y-3">
                <button
                  onClick={handleReopenAnswers}
                  disabled={actionBusy}
                  style={{
                    background: 'transparent',
                    color: C.liveText,
                    border: `1px solid ${C.liveLine}`,
                  }}
                  className="w-full py-3 rounded-xl text-sm font-bold hover:bg-white/5 transition-all active:scale-[0.99] disabled:opacity-50"
                >
                  ← Reopen Answers
                </button>

                <p style={{ color: reviewCount > 0 ? C.caution : C.go }} className="text-[11px] text-center font-semibold uppercase tracking-widest">
                  {reviewCount > 0
                    ? `${reviewCount} answer${reviewCount === 1 ? '' : 's'} still need review`
                    : 'Answers closed — ready to reveal'}
                </p>
                <button
                  onClick={handleRevealAnswer}
                  disabled={actionBusy || !question || reviewCount > 0}
                  style={{
                    background: reviewCount > 0 ? C.livePanel : C.violet,
                    color: reviewCount > 0 ? C.liveDim : 'white',
                    boxShadow: reviewCount > 0 ? 'none' : `0 8px 32px ${C.violet}60`,
                    border: reviewCount > 0 ? `1px solid ${C.liveLine}` : 'none',
                  }}
                  className="w-full py-6 rounded-2xl text-xl font-extrabold hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {actionBusy ? 'Revealing…' : reviewCount > 0 ? 'Resolve Reviews First' : 'Reveal Answer'}
                  {!actionBusy && reviewCount === 0 && <span className="block text-sm font-semibold opacity-80 mt-0.5">& Apply Points</span>}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div style={{ background: `${C.go}18`, border: `1.5px solid ${C.go}50`, borderRadius: 14 }} className="p-3 text-center">
                  <p style={{ color: C.go }} className="font-extrabold text-base">Answer Revealed</p>
                  <p style={{ color: C.liveDim }} className="text-[11px] mt-0.5">{correctDisplay}</p>
                </div>
                <button onClick={handleAdvance} disabled={actionBusy}
                  style={{ background: C.violet, color: 'white', boxShadow: `0 8px 32px ${C.violet}60` }}
                  className="w-full py-6 rounded-2xl text-xl font-extrabold hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50">
                  {actionBusy ? 'Advancing…' : isFinalQuestion ? 'Finish Game →' : nextIsNewRound ? 'End Round →' : 'Next Question →'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 10: END OF ROUND ──────────────────────────────────────────────────

function EndOfRound({ go }: { go: Go }) {
  const [intermission, setIntermission] = useState(false)
  const [teams, setTeams] = useState<LiveTeam[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<LiveQuestionDefinition | null>(null)
  const [nextQuestion, setNextQuestion] = useState<LiveQuestionDefinition | null>(null)
  const [totalRounds, setTotalRounds] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadRoundSummary() {
      const { data: game, error: gameError } = await supabase
        .from('games')
        .select('id, current_question_key, current_screen')
        .eq('code', getHostGameCode())
        .maybeSingle()

      if (!active) return
      if (gameError || !game) {
        setError('Could not load the round summary.')
        return
      }

      setIntermission(game.current_screen === 'intermission')

      const [{ data: questionRows }, { data: teamRows }] = await Promise.all([
        supabase
          .from('game_questions')
          .select('question_key, position, round_number, round_position, round_question_count, round_title, prompt, category, difficulty, question_type, correct_answer, options, image_url, points_max, notes')
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
      const next = current ? questions.find(item => item.position > current.position) ?? null : null

      setCurrentQuestion(current)
      setNextQuestion(next)
      setTotalRounds(Math.max(1, ...questions.map(item => item.round_number)))
      setTeams((teamRows ?? []) as LiveTeam[])
      setError(null)
    }

    void loadRoundSummary()
    return () => { active = false }
  }, [])

  async function toggleIntermission() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = !intermission
      await updateLiveGame({ current_screen: next ? 'intermission' : 'round-results' })
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
        current_screen: 'round-start',
        answer_phase: 'open',
      })
      go('live-question')
    } catch (err) {
      console.error('Could not start next round:', err)
      setError('Could not start the next round.')
      setBusy(false)
    }
  }

  const leaderboard = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const roundNumber = currentQuestion?.round_number ?? 1

  return (
    <div style={{ background: C.ground }} className="min-h-screen flex flex-col">
      <header style={{ background: C.ink }} className="h-12 flex items-center px-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <div style={{ background: C.violet }} className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold">ST</div>
          <span style={{ color: '#ffffff80' }} className="font-bold text-sm">Simple Trivia</span>
        </div>
        <div className="flex-1 text-center"><span style={{ color: '#ffffff50' }} className="text-sm">Friday Night Trivia</span></div>
        <div style={{ width: 80 }} />
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
        <div className="text-center mb-10">
          <div style={{ background: `${C.go}15`, color: C.go, border: `1px solid ${C.go}30` }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-5">✓ Round Complete</div>
          <h1 style={{ color: C.ink }} className="text-5xl font-extrabold">Round {roundNumber} Complete</h1>
          <p style={{ color: C.sub }} className="mt-2 text-sm">
            {nextQuestion ? `Next up: Round ${nextQuestion.round_number} · ${nextQuestion.round_title}` : 'That was the final round.'}
          </p>
        </div>

        {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: C.stop }} className="rounded-xl px-4 py-3 mb-5 text-sm font-semibold">{error}</div>}

        <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5 mb-7">
          <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider mb-4">Current Standings</p>
          <div className="space-y-1.5">
            {leaderboard.map((team, i) => (
              <div key={team.id} style={{ background: i < 3 ? C.ground : 'transparent' }} className="flex items-center gap-4 p-3 rounded-xl">
                <div style={{ background: i === 0 ? C.violetPale : C.panel, color: i === 0 ? C.violet : C.sub, border: `1px solid ${C.line}`, width: 32, height: 32 }}
                  className="rounded-full flex items-center justify-center text-sm font-extrabold shrink-0">{i + 1}</div>
                <span style={{ color: C.ink }} className="flex-1 text-sm font-semibold">{team.name}</span>
                <span style={{ color: C.ink }} className="font-extrabold tabular-nums">{team.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <Btn v="secondary" sz="md" cls="flex-1 justify-center" onClick={toggleIntermission} disabled={busy}>
            {intermission ? 'Hide Intermission' : 'Take a Break'}
          </Btn>
          {nextQuestion ? (
            <Btn sz="lg" cls="flex-1 justify-center" onClick={startNextRound} disabled={busy}>
              Start Round {nextQuestion.round_number}
            </Btn>
          ) : (
            <Btn sz="lg" cls="flex-1 justify-center" onClick={() => go('final-results')}>View Final Results</Btn>
          )}
        </div>

        {intermission && (
          <div style={{ border: `2px dashed ${C.line}` }} className="rounded-2xl overflow-hidden">
            <div style={{ background: C.ground, borderBottom: `1px solid ${C.line}` }} className="text-center py-2">
              <span style={{ color: C.sub }} className="text-xs font-semibold">Player screen is now showing intermission</span>
            </div>
            <div style={{ background: C.liveBg }} className="p-14 text-center">
              <h2 style={{ color: C.liveText }} className="text-2xl font-extrabold mb-2">Intermission</h2>
              <p style={{ color: C.liveDim }} className="text-sm">The next round will begin shortly.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── SCREEN 11: FINAL RESULTS ─────────────────────────────────────────────────

function FinalResults({ go }: { go: Go }) {
  const [teams, setTeams] = useState<LiveTeam[]>([])

  useEffect(() => {
    let active = true
    async function loadFinal() {
      const { data: game } = await supabase.from('games').select('id').eq('code', getHostGameCode()).maybeSingle()
      if (!active || !game) return
      const { data } = await supabase.from('teams').select('id, name, score').eq('game_id', game.id).order('score', { ascending: false })
      if (active) setTeams((data ?? []) as LiveTeam[])
    }
    void loadFinal()
    return () => { active = false }
  }, [])

  const leaderboard = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const winner = leaderboard[0]

  return (
    <div style={{ background: C.ground }} className="min-h-screen flex flex-col">
      <header style={{ background: C.ink }} className="h-12 flex items-center px-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <div style={{ background: C.violet }} className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold">ST</div>
          <span style={{ color: '#ffffff80' }} className="font-bold text-sm">Simple Trivia</span>
        </div>
        <div className="flex-1 text-center"><span style={{ color: '#ffffff50' }} className="text-sm">Friday Night Trivia</span></div>
        <div style={{ width: 80 }} />
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
        <div className="text-center mb-10">
          <div style={{ background: C.violetPale, color: C.violet }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-4">★ Game Complete</div>
          <h1 style={{ color: C.ink }} className="text-5xl font-extrabold">What a night!</h1>
        </div>

        {winner && (
          <div style={{ background: C.violet, color: 'white' }} className="rounded-3xl p-8 text-center mb-8 shadow-xl">
            <div className="text-4xl mb-2">🏆</div>
            <p className="text-sm font-bold uppercase tracking-widest opacity-80">Winner</p>
            <h2 className="text-3xl font-extrabold mt-2">{winner.name}</h2>
            <p className="text-5xl font-black mt-3">{winner.score}</p>
            <p className="text-sm opacity-75">points</p>
          </div>
        )}

        <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5 mb-8">
          <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider mb-3">Final Standings</p>
          <div style={{ borderTop: `1px solid ${C.line}` }}>
            {leaderboard.map((team, i) => (
              <div key={team.id} style={{ borderBottom: `1px solid ${C.line}` }} className="flex items-center gap-3 py-3 last:border-0">
                <span style={{ color: i < 3 ? C.ink : C.sub }} className="w-5 text-center text-sm shrink-0 font-extrabold">{i + 1}</span>
                <span style={{ color: C.ink }} className="flex-1 text-sm font-semibold">{team.name}</span>
                <span style={{ color: C.ink }} className="font-extrabold tabular-nums">{team.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <Btn v="secondary" sz="md" cls="flex-1 justify-center">View Game Summary</Btn>
          <Btn sz="lg" cls="flex-1 justify-center" onClick={() => go('dashboard')}>Finish &amp; Return to My Quizzes</Btn>
        </div>
      </main>
    </div>
  )
}

// ─── SCREEN NAVIGATOR (dev tool) ──────────────────────────────────────────────

const SCREENS: [Screen, string][] = [
  ['dashboard', '1 · Dashboard'],
  ['create-quiz', '2 · Create Quiz'],
  ['quiz-builder', '3 · Quiz Builder'],
  ['auto-build', '5 · Auto-Build'],
  ['quiz-review', '6 · Quiz Review'],
  ['host-setup', '7 · Host Setup'],
  ['lobby', '8 · Lobby'],
  ['live-question', '9 · Live Console'],
  ['end-of-round', '10 · End of Round'],
  ['final-results', '11 · Final Results'],
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

export default function App() {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const screens: Record<Screen, React.ReactNode> = {
    'dashboard': <Dashboard go={setScreen} />,
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
  return (
    <div>
      {screens[screen]}
      <ScreenNav current={screen} go={setScreen} />
    </div>
  )
}
