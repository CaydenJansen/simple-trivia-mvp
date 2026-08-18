"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Screen =
  | 'dashboard' | 'create-quiz' | 'quiz-builder'
  | 'auto-build' | 'quiz-review' | 'host-setup'
  | 'lobby' | 'live-question' | 'end-of-round' | 'final-results'
type Go = (s: Screen) => void

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

function Dashboard({ go }: { go: Go }) {
  const [empty, setEmpty] = useState(false)
  return (
    <div style={{ background: C.ground }} className="min-h-screen">
      <Nav go={go} active="My Quizzes" />
      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Stats row */}
        <div className="flex items-center gap-4 mb-8">
          {[
            { label: 'Quizzes', value: '4' },
            { label: 'Games hosted', value: '23' },
          ].map(s => (
            <div key={s.label} style={{ background: C.panel, border: `1px solid ${C.line}` }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl">
              <span style={{ color: C.ink }} className="text-xl font-bold">{s.value}</span>
              <span style={{ color: C.sub }} className="text-sm">{s.label}</span>
            </div>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setEmpty(e => !e)}
            style={{ color: C.sub }} className="text-xs hover:text-violet transition-colors px-2">
            {empty ? 'Show quizzes' : 'Preview empty state'}
          </button>
          <Btn onClick={() => go('create-quiz')} sz="sm">
            <I.plus /> Create Quiz
          </Btn>
        </div>

        {empty ? (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <div style={{ background: C.violetPale }} className="w-18 h-18 rounded-2xl flex items-center justify-center mb-5 w-16 h-16">
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                <rect x="5" y="3" width="24" height="28" rx="3.5" stroke={C.violet} strokeWidth="1.8"/>
                <path d="M11 12h12M11 17.5h8" stroke={C.violet} strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="24.5" cy="26" r="5.5" fill={C.violet}/>
                <path d="M22.5 26h4M24.5 24v4" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 style={{ color: C.ink }} className="text-xl font-bold mb-2">No quizzes yet</h2>
            <p style={{ color: C.sub }} className="text-sm max-w-[280px] mb-6 leading-relaxed">
              Create your first quiz to get started. Build from scratch or let us generate one for you.
            </p>
            <Btn onClick={() => go('create-quiz')}>
              <I.plus /> Create Quiz
            </Btn>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {QUIZZES.map(q => <QuizCard key={q.id} q={q} go={go} />)}
            <button
              onClick={() => go('create-quiz')}
              style={{ border: `2px dashed ${C.line}` }}
              className="rounded-2xl flex flex-col items-center justify-center gap-2.5 min-h-[210px] group hover:border-violet transition-colors"
            >
              <div style={{ background: C.violetMist }} className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors group-hover:bg-violet-pale">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 3.5v11M3.5 9h11" stroke={C.violet} strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <span style={{ color: C.sub }} className="text-sm font-semibold group-hover:text-violet transition-colors">New Quiz</span>
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function QuizCard({ q, go }: { q: typeof QUIZZES[0]; go: Go }) {
  const ready = q.status === 'Ready'
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
        <Chip color={ready ? 'ready' : 'draft'}>{q.status}</Chip>
      </div>
      <div style={{ color: C.sub }} className="text-sm flex items-center gap-2 mb-1">
        <span>{q.rounds} rounds</span>
        <span style={{ color: C.line }}>·</span>
        <span>{q.questions} questions</span>
        <span style={{ color: C.line }}>·</span>
        <span>~{q.mins} mins</span>
      </div>
      <p style={{ color: C.sub }} className="text-xs mb-auto pb-4">Edited {q.edited}</p>
      <div style={{ borderTop: `1px solid ${C.line}` }} className="flex items-center gap-2 pt-3.5 mt-2">
        <Btn v="ghost" sz="sm" onClick={() => go('quiz-builder')} cls="flex-1 justify-center">Edit</Btn>
        <Btn sz="sm" onClick={() => go('host-setup')} cls="flex-1 justify-center">Host Game</Btn>
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
                <p style={{ color: '#B45309' }} className="text-xs mb-3">The existing answer options will be removed. This can't be undone.</p>
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
          <span style={{ color: C.ink }} className="font-bold">Friday Night Trivia</span>
          <span style={{ color: C.line }}>·</span>
          <span>30 questions · 6 rounds</span>
        </div>

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

          <Btn sz="lg" cls="w-full" onClick={() => go('lobby')}>Open Lobby →</Btn>
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
  const [teams, setTeams] = useState<LobbyTeam[]>([])
  const [lobbyError, setLobbyError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function setupLobby() {
      setLobbyError(null)

      const { data: game, error: gameError } = await supabase
        .from("games")
        .select("id")
        .eq("code", "728461")
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
  }, [])

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
          <h1 style={{ color: C.ink }} className="text-3xl font-extrabold mb-1">Friday Night Trivia</h1>
          <p style={{ color: C.sub }} className="text-sm">Share the code or QR so teams can join on their phones.</p>
        </div>

        <div className="grid grid-cols-2 gap-8 items-start">
          {/* Code + QR */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-8 flex flex-col items-center text-center">
            <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-widest mb-4">Game Code</p>
            <div style={{ color: C.ink, letterSpacing: '0.2em' }} className="text-6xl font-extrabold mb-7 tabular-nums">
              728461
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
            <Btn sz="lg" cls="w-full" onClick={() => go('live-question')}>Start Quiz</Btn>
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── SCREEN 9: LIVE QUESTION ──────────────────────────────────────────────────
// Dark operational mode — the host is on stage

function LiveQuestion({ go }: { go: Go }) {
  const [phase, setPhase] = useState<'open' | 'closed' | 'revealed'>('open')
  const [emergency, setEmergency] = useState(false)
  const answers = [
    { team: 'Trivia Newton John', answer: 'Canada', status: 'correct' as const, waiting: false },
    { team: 'Quizteama Aguilera', answer: 'Canada', status: 'correct' as const, waiting: false },
    { team: 'Norfolk & Chance', answer: 'Cannada', status: 'review' as const, waiting: false },
    { team: 'Risky Quizness', answer: 'Russia', status: 'incorrect' as const, waiting: false },
    { team: 'The Know-It-Alls', answer: 'Canada', status: 'correct' as const, waiting: false },
    { team: 'Quiz Khalifa', answer: '', status: 'incorrect' as const, waiting: true },
    { team: 'I Am Smarticus', answer: '', status: 'incorrect' as const, waiting: true },
  ]

  return (
    <div style={{ background: C.liveBg, color: C.liveText }} className="h-screen flex flex-col overflow-hidden">
      {/* Live top bar */}
      <header style={{ background: C.liveSurface, borderBottom: `1px solid ${C.liveLine}`, height: 52 }}
        className="flex items-center px-6 gap-4 shrink-0">
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
          <span style={{ color: C.liveDim }}>Round 2 of 6</span>
          <span style={{ color: C.liveLine }}>·</span>
          <span style={{ color: C.liveText }} className="font-bold">Question 3 of 5</span>
          <span style={{ color: C.liveLine }}>·</span>
          <span style={{ color: C.liveDim }}>Friday Night Trivia</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative">
            <button onClick={() => setEmergency(e => !e)}
              style={{ border: `1px solid ${C.liveLine}`, color: C.liveDim }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:border-caution hover:text-caution transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 3.5v3M6 8v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Controls
            </button>
            {emergency && (
              <div style={{ background: C.livePanel, border: `1px solid ${C.liveLine}`, right: 0, top: '100%', marginTop: 6, width: 200, zIndex: 50 }}
                className="absolute rounded-xl shadow-2xl p-2 space-y-0.5">
                <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest px-2 py-1">Game Controls</p>
                {[
                  { label: 'Pause Game', icon: '⏸' },
                  { label: 'Reopen Answers', icon: '↩' },
                  { label: 'Go Back to Previous', icon: '←' },
                ].map(item => (
                  <button key={item.label} onClick={() => setEmergency(false)}
                    style={{ color: C.liveText }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-live-surface transition-colors text-left">
                    <span className="text-base leading-none">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span style={{ background: '#DC2626' }} className="w-2 h-2 rounded-full animate-pulse" />
          <span style={{ color: C.liveDim }} className="text-xs font-semibold">LIVE</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Question + Answers */}
        <div className="flex-1 flex flex-col px-7 py-6 overflow-y-auto gap-5 min-w-0">
          {/* Question card */}
          <div style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }} className="rounded-2xl p-6 shrink-0">
            <p style={{ color: C.liveDim }} className="text-[11px] font-bold uppercase tracking-widest mb-3">Geography · Medium</p>
            <p style={{ color: C.liveText }} className="text-3xl font-extrabold leading-snug mb-5">
              Which country has the longest coastline in the world?
            </p>

            {/* Correct answer — always visible to host, styling shifts on reveal */}
            {phase !== 'revealed' ? (
              <div style={{ background: `${C.violet}12`, border: `1px dashed ${C.violet}50` }}
                className="flex items-center gap-3 rounded-xl px-4 py-3 mb-3">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="1" width="12" height="12" rx="3" stroke={C.violet} strokeWidth="1.3" strokeDasharray="2.5 1.5"/>
                  <path d="M4 7h6M7 4v6" stroke={C.violet} strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
                </svg>
                <div className="flex-1 min-w-0">
                  <p style={{ color: `${C.violet}99` }} className="text-[10px] font-bold uppercase tracking-widest">Correct Answer · Host only</p>
                  <p style={{ color: C.violet }} className="text-lg font-extrabold mt-0.5">Canada</p>
                </div>
                <span style={{ color: `${C.violet}60`, border: `1px solid ${C.violet}30` }}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0">Not revealed</span>
              </div>
            ) : (
              <div style={{ background: `${C.go}20`, border: `1.5px solid ${C.go}60` }}
                className="flex items-center gap-3 rounded-xl px-4 py-3 mb-3">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="8" fill={C.go} fillOpacity="0.2"/><path d="M5 9l3 3 5-5" stroke={C.go} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <div className="flex-1 min-w-0">
                  <p style={{ color: C.liveDim }} className="text-[10px] font-bold uppercase tracking-widest">Correct Answer · Revealed to players</p>
                  <p style={{ color: C.go }} className="text-xl font-extrabold mt-0.5">Canada</p>
                </div>
              </div>
            )}

            {/* Host notes — always visible */}
            <div style={{ background: `${C.violet}10`, border: `1px dashed ${C.violet}40` }}
              className="flex items-start gap-3 rounded-xl p-3.5">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 mt-0.5">
                <rect x="1" y="1" width="12" height="12" rx="3" stroke={C.violet} strokeWidth="1.3" strokeDasharray="2.5 1.5"/>
              </svg>
              <div>
                <p style={{ color: `${C.violet}80` }} className="text-[10px] font-bold uppercase tracking-widest mb-1">Notes · Host only</p>
                <p style={{ color: `${C.liveText}99` }} className="text-sm leading-relaxed">
                  Canada has approximately 202,080 km of coastline depending on measurement methodology.
                </p>
              </div>
            </div>
          </div>

          {/* Persistent state label */}
          <div style={{
            background: phase === 'open' ? `${C.violet}20` : phase === 'closed' ? `${C.caution}20` : `${C.go}20`,
            border: `1px solid ${phase === 'open' ? `${C.violet}40` : phase === 'closed' ? `${C.caution}40` : `${C.go}40`}`,
            color: phase === 'open' ? C.violet : phase === 'closed' ? C.caution : C.go,
          }} className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-extrabold uppercase tracking-widest shrink-0">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'currentColor' }} />
            {phase === 'open' ? 'Accepting Answers' : phase === 'closed' ? 'Answers Closed' : 'Answer Revealed'}
          </div>

          {/* Answer progress + table */}
          <div className="flex items-center justify-between shrink-0">
            <h3 style={{ color: C.liveText }} className="font-bold text-sm">Team Answers</h3>
            <div className="flex items-center gap-3">
              <div style={{ background: C.liveLine }} className="h-1.5 w-32 rounded-full overflow-hidden">
                <div style={{ width: `${(5/7)*100}%`, background: C.violet }} className="h-full rounded-full" />
              </div>
              <span style={{ color: C.liveText }} className="text-sm font-bold tabular-nums">5 / 7</span>
              <span style={{ color: C.liveDim }} className="text-xs">answered</span>
            </div>
          </div>

          <div style={{ background: C.liveSurface, border: `1px solid ${C.liveLine}` }}
            className="rounded-2xl overflow-hidden flex-1">
            <div style={{
              background: C.livePanel,
              borderBottom: `1px solid ${C.liveLine}`,
              color: C.liveDim,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
            }} className="text-[10px] font-bold uppercase tracking-widest px-4 py-2.5">
              <span>Team</span><span className="text-center">Answer</span><span className="text-center">Status</span>
            </div>
            {answers.map(row => {
              const isReview = !row.waiting && row.status === 'review'
              return (
                <div key={row.team}
                  style={{
                    borderBottom: `1px solid ${isReview ? C.caution + '40' : C.liveLine}`,
                    background: isReview ? `${C.caution}15` : 'transparent',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    alignItems: 'center',
                  }}
                  className="last:border-0 px-4 py-3 gap-3">

                  {/* Col 1: Team name */}
                  <span style={{ color: row.waiting ? `${C.liveText}45` : isReview ? C.liveText : `${C.liveText}80` }}
                    className={`text-sm truncate ${isReview ? 'font-bold' : 'font-medium'}`}>
                    {row.team}
                  </span>

                  {/* Col 2: Answer */}
                  <span style={{ color: row.waiting ? C.liveDim : isReview ? C.liveText : `${C.liveText}70` }}
                    className={`text-sm text-center italic ${isReview ? 'font-semibold' : ''}`}>
                    {row.waiting ? 'Waiting…' : row.answer}
                  </span>

                  {/* Col 3: Status / actions */}
                  <div className="flex items-center justify-end gap-2">
                    {row.waiting && (
                      <span style={{ color: C.liveDim }} className="text-xs">—</span>
                    )}
                    {!row.waiting && row.status === 'correct' && (
                      <span style={{ background: `${C.go}25`, color: C.go, border: `1px solid ${C.go}40` }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        Correct
                      </span>
                    )}
                    {!row.waiting && row.status === 'incorrect' && (
                      <span style={{ background: `${C.stop}20`, color: C.stop, border: `1px solid ${C.stop}35` }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                        Incorrect
                      </span>
                    )}
                    {isReview && (
                      <>
                        <button style={{ background: C.go, color: 'white' }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold hover:opacity-90 transition-opacity shrink-0">
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          Accept
                        </button>
                        <button style={{ background: C.stop, color: 'white' }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold hover:opacity-90 transition-opacity shrink-0">
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3l6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round"/></svg>
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: Leaderboard + Controls */}
        <div style={{ background: C.liveSurface, borderLeft: `1px solid ${C.liveLine}`, width: 280 }}
          className="flex flex-col shrink-0">
          {/* Leaderboard */}
          <div className="flex-1 p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p style={{ color: C.liveDim }} className="text-[11px] font-bold uppercase tracking-widest">Leaderboard</p>
              <p style={{ color: C.liveDim }} className="text-[10px] font-mono">pts = questions correct</p>
            </div>
            <div className="space-y-1">
              {LB.map((t, i) => (
                <div key={t.name}
                  style={{ background: i === 0 ? `${C.violet}20` : 'transparent' }}
                  className="flex items-center gap-3 p-2.5 rounded-xl">
                  <div style={{
                    background: i === 0 ? C.violet : C.liveLine,
                    color: i === 0 ? 'white' : C.liveDim,
                    width: 24, height: 24,
                  }} className="rounded-full flex items-center justify-center text-xs font-bold shrink-0 tabular-nums">
                    {i + 1}
                  </div>
                  <span style={{ color: i === 0 ? C.liveText : `${C.liveText}99` }}
                    className={`text-sm flex-1 truncate ${i === 0 ? 'font-bold' : 'font-medium'}`}>{t.name}</span>
                  <span style={{ color: i === 0 ? C.liveText : `${C.liveText}99` }}
                    className="text-sm font-bold tabular-nums">{t.score} <span style={{ color: C.liveDim }} className="text-[10px] font-normal">pts</span></span>
                </div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div style={{ borderTop: `1px solid ${C.liveLine}` }} className="p-5 shrink-0">
            {phase === 'open' && (
              <div className="space-y-3">
                <p style={{ color: C.liveDim }} className="text-[11px] text-center font-semibold uppercase tracking-widest">Accepting answers…</p>
                <button
                  onClick={() => setPhase('closed')}
                  style={{ border: `2px solid ${C.liveLine}`, color: C.liveText, background: C.livePanel }}
                  className="w-full py-6 rounded-2xl text-xl font-extrabold hover:border-violet hover:text-violet transition-all active:scale-[0.98]">
                  Close Answers
                </button>
              </div>
            )}
            {phase === 'closed' && (
              <div className="space-y-3">
                <p style={{ color: C.caution }} className="text-[11px] text-center font-semibold uppercase tracking-widest">Answers closed — ready to reveal</p>
                <button
                  onClick={() => setPhase('revealed')}
                  style={{ background: C.violet, color: 'white', boxShadow: `0 8px 32px ${C.violet}60` }}
                  className="w-full py-6 rounded-2xl text-xl font-extrabold hover:opacity-90 transition-all active:scale-[0.98]">
                  Reveal Answer
                  <span className="block text-sm font-semibold opacity-80 mt-0.5">& Apply Points</span>
                </button>
              </div>
            )}
            {phase === 'revealed' && (
              <div className="space-y-3">
                <div style={{ background: `${C.go}18`, border: `1.5px solid ${C.go}50`, borderRadius: 14 }} className="p-3 text-center">
                  <div style={{ background: C.go, color: 'white' }}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest mb-1.5">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Answer Revealed
                  </div>
                  <p style={{ color: C.liveText }} className="font-extrabold text-base">Canada</p>
                  <p style={{ color: C.liveDim }} className="text-[11px] mt-0.5">Points applied to all teams</p>
                </div>
                <button
                  onClick={() => go('end-of-round')}
                  style={{ background: C.violet, color: 'white', boxShadow: `0 8px 32px ${C.violet}60` }}
                  className="w-full py-6 rounded-2xl text-xl font-extrabold hover:opacity-90 transition-all active:scale-[0.98]">
                  Next Question →
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

  return (
    <div style={{ background: C.ground }} className="min-h-screen flex flex-col">
      <header style={{ background: C.ink }} className="h-12 flex items-center px-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <div style={{ background: C.violet }} className="w-6 h-6 rounded-md flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="5" r="2.5" fill="white"/>
              <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ color: '#ffffff80' }} className="font-bold text-sm">Simple Trivia</span>
        </div>
        <div className="flex-1 text-center">
          <span style={{ color: '#ffffff50' }} className="text-sm">Friday Night Trivia</span>
        </div>
        <div style={{ width: 80 }} />
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
        <div className="text-center mb-10">
          <div style={{ background: `${C.go}15`, color: C.go, border: `1px solid ${C.go}30` }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-5">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Round Complete
          </div>
          <h1 style={{ color: C.ink }} className="text-5xl font-extrabold">Round 2 Complete</h1>
          <p style={{ color: C.sub }} className="mt-2 text-sm">4 rounds remaining · Next up: Movies</p>
        </div>

        {/* Leaderboard */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5 mb-7">
          <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider mb-4">Current Standings</p>
          <div className="space-y-1.5">
            {LB.map((t, i) => (
              <div key={t.name}
                style={{ background: i < 3 ? C.ground : 'transparent' }}
                className="flex items-center gap-4 p-3 rounded-xl">
                <div style={{
                  background: i === 0 ? '#FEF9C3' : i === 1 ? '#F4F4F5' : i === 2 ? '#FFF7ED' : 'transparent',
                  color: i === 0 ? '#854D0E' : i === 1 ? '#52525B' : i === 2 ? '#9A3412' : C.sub,
                  border: i >= 3 ? `1px solid ${C.line}` : 'none',
                  width: 32, height: 32,
                }} className="rounded-full flex items-center justify-center text-sm font-extrabold shrink-0">
                  {i + 1}
                </div>
                <span style={{ color: C.ink }} className="flex-1 text-sm font-semibold">{t.name}</span>
                <span style={{ color: C.ink }} className="font-extrabold tabular-nums">{t.score}</span>
                {i > 0 && (
                  <span style={{ color: C.sub }} className="text-xs font-mono text-right flex items-baseline gap-0.5">
                    <span>-{LB[0].score - t.score}</span>
                    <span className="text-[9px] font-sans opacity-60">behind</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <Btn v="secondary" sz="md" cls="flex-1 justify-center" onClick={() => setIntermission(v => !v)}>
            {intermission ? 'Hide Intermission' : 'Take a Break'}
          </Btn>
          <Btn sz="lg" cls="flex-1 justify-center" onClick={() => go('live-question')}>Start Round 3</Btn>
        </div>

        {intermission && (
          <div style={{ border: `2px dashed ${C.line}` }} className="rounded-2xl overflow-hidden">
            <div style={{ background: C.ground, borderBottom: `1px solid ${C.line}` }}
              className="text-center py-2">
              <span style={{ color: C.sub }} className="text-xs font-semibold">Player screen preview</span>
            </div>
            <div style={{ background: C.liveBg }} className="p-14 text-center">
              <div style={{ background: C.violet }} className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="5" r="2.5" fill="white"/>
                  <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </div>
              <h2 style={{ color: C.liveText }} className="text-2xl font-extrabold mb-2">Intermission</h2>
              <p style={{ color: C.liveDim }} className="text-sm">The next round will begin shortly.</p>
              <div className="flex items-center justify-center gap-1.5 mt-6">
                {[0, 1, 2].map(i => (
                  <div key={i}
                    style={{ background: `${C.liveDim}60`, width: 6, height: 6, animationDelay: `${i * 250}ms` }}
                    className="rounded-full animate-pulse" />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── SCREEN 11: FINAL RESULTS ─────────────────────────────────────────────────

function FinalResults({ go }: { go: Go }) {
  const top = LB.slice(0, 3)
  const podium = [
    { idx: 1, team: top[1], medal: '🥈', h: 96, bg: '#F4F4F5', txt: '#52525B', border: '#D4D4D8' },
    { idx: 0, team: top[0], medal: '🥇', h: 140, bg: '#FEF9C3', txt: '#854D0E', border: '#FDE68A' },
    { idx: 2, team: top[2], medal: '🥉', h: 72, bg: '#FFF7ED', txt: '#9A3412', border: '#FED7AA' },
  ]

  return (
    <div style={{ background: C.ground }} className="min-h-screen flex flex-col">
      <header style={{ background: C.ink }} className="h-12 flex items-center px-6 shrink-0">
        <div className="flex items-center gap-2.5">
          <div style={{ background: C.violet }} className="w-6 h-6 rounded-md flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="5" r="2.5" fill="white"/>
              <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ color: '#ffffff80' }} className="font-bold text-sm">Simple Trivia</span>
        </div>
        <div className="flex-1 text-center">
          <span style={{ color: '#ffffff50' }} className="text-sm">Friday Night Trivia</span>
        </div>
        <div style={{ width: 80 }} />
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">
        <div className="text-center mb-12">
          <div style={{ background: C.violetPale, color: C.violet }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-4">
            <I.star /> Game Complete
          </div>
          <h1 style={{ color: C.ink }} className="text-5xl font-extrabold">
            {"What a night!"}
          </h1>
        </div>

        {/* Podium */}
        <div className="flex items-end justify-center gap-4 mb-10">
          {podium.map(p => (
            <div key={p.idx} className="flex flex-col items-center" style={{ width: p.idx === 0 ? 160 : 130 }}>
              <div style={{
                  border: `3px solid ${p.border}`, background: p.bg, color: p.txt,
                  width: p.idx === 0 ? 64 : 52, height: p.idx === 0 ? 64 : 52, fontSize: p.idx === 0 ? 22 : 18,
                }}
                className="rounded-full flex items-center justify-center font-extrabold mb-2">
                {p.idx + 1}
              </div>
              <p style={{ color: C.ink }} className="text-xs font-bold text-center mb-1 leading-tight px-1">{p.team.name}</p>
              <p style={{ color: C.violet }} className={`font-extrabold tabular-nums mb-2 ${p.idx === 0 ? 'text-3xl' : 'text-2xl'}`}>
                {p.team.score}
              </p>
              <div
                style={{ height: p.h, background: p.bg, border: `1.5px solid ${p.border}`, width: '100%' }}
                className="rounded-t-xl flex items-center justify-center text-3xl">
                {p.medal}
              </div>
            </div>
          ))}
        </div>

        {/* Prize placements */}
        {[
          { place: 0, label: '1st Place', icon: '🏆', bg: '#FEF9C3', border: '#FDE68A', txt: '#854D0E', body: '#92400E', msg: "You've won a $100 venue voucher!" },
          { place: 1, label: '2nd Place', icon: '🥈', bg: '#F4F4F5', border: '#D4D4D8', txt: '#52525B', body: '#71717A', msg: '' },
          { place: 2, label: '3rd Place', icon: '🥉', bg: '#FFF7ED', border: '#FED7AA', txt: '#9A3412', body: '#C2410C', msg: '' },
        ].map(p => (
          <div key={p.place} style={{ background: p.bg, border: `1.5px solid ${p.border}` }} className="rounded-2xl p-4 mb-3">
            <div className="flex items-center gap-2 mb-1">
              <span>{p.icon}</span>
              <span style={{ color: p.txt }} className="font-bold text-sm">{p.label} · {top[p.place]?.name}</span>
            </div>
            {p.msg && <p style={{ color: p.body }} className="text-sm">{p.msg}</p>}
          </div>
        ))}

        {/* Full leaderboard */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}` }} className="rounded-2xl p-5 mb-8">
          <p style={{ color: C.sub }} className="text-[11px] font-bold uppercase tracking-wider mb-3">Final Standings</p>
          <div style={{ borderTop: `1px solid ${C.line}` }}>
            {LB.map((t, i) => (
              <div key={t.name}
                style={{ borderBottom: `1px solid ${C.line}` }}
                className="flex items-center gap-3 py-3 last:border-0">
                <span style={{ color: i < 3 ? C.ink : C.sub }} className={`w-5 text-center text-sm shrink-0 ${i < 3 ? 'font-extrabold' : 'font-mono'}`}>{i + 1}</span>
                <span style={{ color: C.ink }} className="flex-1 text-sm font-semibold">{t.name}</span>
                <span style={{ color: C.ink }} className="font-extrabold tabular-nums">{t.score}</span>
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
