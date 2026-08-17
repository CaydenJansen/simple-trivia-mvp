"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

// ─── TYPES ────────────────────────────────────────────────────────────────────
type PlayerScreen =
  | 'join' | 'team-setup' | 'waiting' | 'round-start'
  | 'single-answer' | 'image-question' | 'multiple-choice'
  | 'multi-answer' | 'multi-part' | 'ranking'
  | 'submitted' | 'no-answer' | 'correct' | 'incorrect'
  | 'partial-correct'
  | 'content-screen' | 'intermission' | 'round-results' | 'round-results-hidden'
  | 'delayed-reveal' | 'winner' | 'final-result'
  | 'reconnecting' | 'game-ended'

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
  { id: 'submitted',      label: '11 · Submitted' },
  { id: 'no-answer',      label: '12 · No Answer' },
  { id: 'correct',        label: '13 · Correct' },
  { id: 'incorrect',      label: '14 · Incorrect' },
  { id: 'partial-correct',       label: '13b · Partial Credit' },
  { id: 'content-screen',        label: '15 · Content Screen' },
  { id: 'intermission',          label: '16 · Intermission' },
  { id: 'round-results',         label: '17 · Round Results' },
  { id: 'round-results-hidden',  label: '17b · Results (Hidden LB)' },
  { id: 'delayed-reveal', label: '18 · Delayed Reveal' },
  { id: 'winner',         label: '19 · Winner' },
  { id: 'final-result',   label: '20 · Final Result' },
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
  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.line}` }} className="px-4 pt-3 pb-3 shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div style={{ background: C.violet, borderRadius: 8 }}
            className="w-7 h-7 flex items-center justify-center shrink-0">
            <span className="text-white font-black" style={{ fontSize: 11 }}>ST</span>
          </div>
          <span style={{ color: C.sub, fontSize: 14 }} className="font-semibold">Simple Trivia</span>
        </div>
        {team && (
          <div className="text-right">
            <div style={{ color: C.ink, fontSize: 14 }} className="font-bold leading-tight">{team}</div>
            {score !== undefined && (
              <div style={{ color: C.violet, fontSize: 13 }} className="font-bold">{score} pts</div>
            )}
          </div>
        )}
      </div>
      {(round || question) && (
        <div className="flex items-center gap-2 mt-1.5">
          {round && <span style={{ color: C.sub, fontSize: 13 }} className="font-medium">{round}</span>}
          {round && question && <span style={{ color: C.line, fontSize: 13 }}>·</span>}
          {question && <span style={{ color: C.sub, fontSize: 13 }} className="font-medium">{question}</span>}
        </div>
      )}
    </div>
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

async function handleJoin() {
  setInvalid(false);

  const { data: game, error } = await supabase
    .from("games")
    .select("id, code, title, status")
    .eq("code", code)
    .eq("status", "lobby")
    .maybeSingle();

  if (error) {
    console.error("Error finding game:", error);
    setInvalid(true);
    return;
  }

  if (!game) {
    setInvalid(true);
    return;
  }

  localStorage.setItem("simple-trivia-game-id", game.id);
  localStorage.setItem("simple-trivia-game-code", game.code);

  go("team-setup");
}

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
            placeholder="728461"
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
                We couldn't find that game.
              </p>
              <p style={{ color: C.stop, fontSize: 13, opacity: 0.8 }} className="text-center">
                Check the code and try again.
              </p>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Btn onClick={handleJoin} disabled={code.length < 6}>Join Game</Btn>
          </div>

          <p style={{ color: C.sub, fontSize: 12, marginTop: 12 }} className="text-center">
            Or scan your host's QR code to join instantly.
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

async function handleJoin() {
  setTaken(false);

  const gameId = localStorage.getItem("simple-trivia-game-id");

  if (!gameId) {
    go("join");
    return;
  }

  const { data: team, error } = await supabase
    .from("teams")
    .insert({
      game_id: gameId,
      name: name.trim(),
      score: 0,
    })
    .select("id, name, score")
    .single();

  if (error) {
    console.error("Error creating team:", error);

    if (error.code === "23505") {
      setTaken(true);
    }

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
        <h2 style={{ color: C.ink, fontSize: 20 }} className="font-black">Friday Night Trivia</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h3 style={{ color: C.ink, fontSize: 24 }} className="font-black mb-1">What's your team name?</h3>
        <p style={{ color: C.sub, fontSize: 15, marginBottom: 20 }}>
          This is what you'll appear as on the leaderboard.
        </p>

        <input
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setTaken(false) }}
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
                  <span style={{ color: C.sub, fontSize: 13 }}>Enter it to link tonight's result</span>
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
                onClick={() => {}}
                style={{ color: C.sub, fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '6px 0', textAlign: 'left' }}
              >
                Skip for now →
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
                  Remember this PIN — you'll use it at your next trivia night to pick up where you left off.
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

      <StickyBottom>
        <Btn onClick={handleJoin} disabled={!name.trim()}>Join Game</Btn>
        <p style={{ color: C.sub, fontSize: 13, marginTop: 8 }} className="text-center">One phone per team.</p>
      </StickyBottom>
    </div>
  )
}

// ─── SCREEN 3 — WAITING ───────────────────────────────────────────────────────
function Waiting({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center" style={{ minHeight: '100%' }}>
      <div style={{ background: C.goMist, borderRadius: 999, border: `2px solid ${C.goBorder}`, width: 64, height: 64 }}
        className="flex items-center justify-center mb-6 shrink-0">
        <span style={{ fontSize: 28, color: C.go }}>✓</span>
      </div>

      <h1 style={{ color: C.ink, fontSize: 32 }} className="font-black mb-2">You're in!</h1>

      <div style={{ background: C.violetPale, borderRadius: 18, width: '100%', maxWidth: 300, padding: '18px 24px', marginTop: 8, marginBottom: 24 }}>
        <p style={{ color: C.violet, fontSize: 20 }} className="font-black mb-1">Trivia Newton John</p>
        <p style={{ color: C.sub, fontSize: 14 }}>Friday Night Trivia</p>
      </div>

      <WaitMsg msg="Waiting for the host to start the quiz…" />

      <p style={{ color: C.sub, fontSize: 13, marginTop: 16 }}>7 teams joined</p>

      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 20, marginTop: 28, width: '100%', maxWidth: 260 }}>
        <p style={{ color: C.sub, fontSize: 12 }}>
          Game code{' '}
          <span style={{ color: C.ink, fontWeight: 800, letterSpacing: '0.15em' }}>728 461</span>
        </p>
      </div>

      <div style={{ marginTop: 20 }}>
        <HostAdvance label="host starts game" to="round-start" go={go} />
      </div>
    </div>
  )
}

// ─── SCREEN 4 — ROUND START ───────────────────────────────────────────────────
function RoundStart({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
      <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 20 }}>
        Starting now
      </p>
      <p style={{ color: C.violet, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Round 2 of 6</p>
      <h1 style={{ color: C.ink, fontSize: 42 }} className="font-black mb-2">Movies</h1>
      <p style={{ color: C.sub, fontSize: 16, marginBottom: 40 }}>5 questions</p>
      <WaitMsg msg="Waiting for the first question…" />
      <div style={{ marginTop: 20 }}>
        <HostAdvance label="host opens first question" to="single-answer" go={go} />
      </div>
    </div>
  )
}

// ─── SCREEN 5 — SINGLE ANSWER ─────────────────────────────────────────────────
function SingleAnswer({ go }: { go: (s: PlayerScreen) => void }) {
  const [answer, setAnswer] = useState('')
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 2 of 6" question="Question 3 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div style={{ background: C.violetPale, borderRadius: 8, display: 'inline-flex', padding: '4px 10px', marginBottom: 18 }}>
          <span style={{ color: C.violet, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Geography</span>
        </div>

        <h2 style={{ color: C.ink, fontSize: 24, lineHeight: 1.25, fontWeight: 900, marginBottom: 28 }}>
          Which country has the longest coastline in the world?
        </h2>

        <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
          Your answer
        </label>
        <textarea
          rows={3}
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder="Type your answer…"
          style={{
            border: `2px solid ${answer ? C.violet : C.line}`,
            borderRadius: 14,
            background: C.panel,
            color: C.ink,
            fontSize: 18,
            fontWeight: 500,
            outline: 'none',
            width: '100%',
            padding: '14px 16px',
            resize: 'none',
            fontFamily: 'inherit',
            transition: 'border-color 0.14s',
          }}
        />
      </div>

      <StickyBottom>
        <Btn onClick={() => go('submitted')} disabled={!answer.trim()}>Submit Answer</Btn>
      </StickyBottom>
    </div>
  )
}

// ─── SCREEN 6 — IMAGE QUESTION ────────────────────────────────────────────────
function ImageQuestion({ go }: { go: (s: PlayerScreen) => void }) {
  const [answer, setAnswer] = useState('')
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 2 of 6" question="Question 4 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div style={{
          borderRadius: 16, overflow: 'hidden', background: C.ground,
          border: `1px solid ${C.line}`, marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 180,
        }}>
          <img
            src="https://upload.wikimedia.org/wikipedia/en/9/9e/Flag_of_Japan.svg"
            alt="Japanese flag — white background with a red circle in the centre"
            style={{ maxHeight: 140, maxWidth: '80%', objectFit: 'contain' }}
          />
        </div>

        <h2 style={{ color: C.ink, fontSize: 24, lineHeight: 1.25, fontWeight: 900, marginBottom: 24 }}>
          Which country does this flag belong to?
        </h2>

        <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
          Your answer
        </label>
        <textarea
          rows={3}
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          placeholder="Type your answer…"
          style={{
            border: `2px solid ${answer ? C.violet : C.line}`,
            borderRadius: 14,
            background: C.panel,
            color: C.ink,
            fontSize: 18,
            fontWeight: 500,
            outline: 'none',
            width: '100%',
            padding: '14px 16px',
            resize: 'none',
            fontFamily: 'inherit',
            transition: 'border-color 0.14s',
          }}
        />
      </div>

      <StickyBottom>
        <Btn onClick={() => go('submitted')} disabled={!answer.trim()}>Submit Answer</Btn>
      </StickyBottom>
    </div>
  )
}

// ─── SCREEN 7 — MULTIPLE CHOICE ───────────────────────────────────────────────
function MultipleChoice({ go }: { go: (s: PlayerScreen) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const choices = [
    { key: 'A', label: 'Parasite' },
    { key: 'B', label: '1917' },
    { key: 'C', label: 'Joker' },
    { key: 'D', label: 'Once Upon a Time in Hollywood' },
  ]
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 2 of 6" question="Question 2 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h2 style={{ color: C.ink, fontSize: 22, lineHeight: 1.3, fontWeight: 900, marginBottom: 24 }}>
          Which film won Best Picture at the 2020 Academy Awards?
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {choices.map(c => {
            const isSel = selected === c.key
            return (
              <button
                key={c.key}
                onClick={() => setSelected(c.key)}
                style={{
                  background: isSel ? C.violetPale : C.panel,
                  border: `2px solid ${isSel ? C.violet : C.line}`,
                  borderRadius: 16,
                  textAlign: 'left',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.14s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  fontFamily: 'inherit',
                }}
              >
                <span style={{
                  background: isSel ? C.violet : C.ground,
                  color: isSel ? '#fff' : C.sub,
                  borderRadius: 10,
                  width: 36, height: 36,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 15,
                  flexShrink: 0,
                  transition: 'all 0.14s',
                }}>{c.key}</span>
                <span style={{ color: C.ink, fontWeight: 600, fontSize: 16 }}>{c.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <StickyBottom>
        <Btn onClick={() => go('submitted')} disabled={!selected}>Submit Answer</Btn>
      </StickyBottom>
    </div>
  )
}

// ─── SCREEN 8 — MULTI-ANSWER ──────────────────────────────────────────────────
function MultiAnswer({ go }: { go: (s: PlayerScreen) => void }) {
  const [answers, setAnswers] = useState(['', '', ''])
  const setA = (i: number, v: string) => setAnswers(prev => prev.map((a, idx) => idx === i ? v : a))
  const anyFilled = answers.some(a => a.trim())
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 2 of 6" question="Question 5 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h2 style={{ color: C.ink, fontSize: 23, lineHeight: 1.3, fontWeight: 900, marginBottom: 6 }}>
          Name the three countries of Benelux.
        </h2>
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>1 point per correct answer</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {answers.map((a, i) => (
            <div key={i}>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
                Answer {i + 1}
              </label>
              <input
                type="text"
                value={a}
                onChange={e => setA(i, e.target.value)}
                placeholder="Type your answer…"
                style={{
                  border: `2px solid ${a ? C.violet : C.line}`,
                  borderRadius: 14,
                  background: C.panel,
                  color: C.ink,
                  fontSize: 17,
                  fontWeight: 500,
                  outline: 'none',
                  width: '100%',
                  padding: '13px 16px',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.14s',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <StickyBottom>
        <Btn onClick={() => go('submitted')} disabled={!anyFilled}>Submit Answers</Btn>
      </StickyBottom>
    </div>
  )
}

// ─── SCREEN 9 — MULTI-PART ────────────────────────────────────────────────────
function MultiPart({ go }: { go: (s: PlayerScreen) => void }) {
  const [answers, setAnswers] = useState(['', '', ''])
  const parts = [
    { label: 'A', clue: 'Gold Rings, Red Star Rings and Emerald Gems' },
    { label: 'B', clue: 'Wumpa Fruit, Coloured Gems and Time Relics' },
    { label: 'C', clue: 'Musical Notes, Red and Gold Feathers, and Blue Eggs' },
  ]
  const anyFilled = answers.some(a => a.trim())
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 3 of 6" question="Question 2 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h2 style={{ color: C.ink, fontSize: 19, lineHeight: 1.35, fontWeight: 900, marginBottom: 6 }}>
          Like the Coins and Mushrooms from the Super Mario series, identify the video game franchise from their collectible items:
        </h2>
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>1 point per part</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {parts.map((p, i) => (
            <div key={i}>
              <div style={{ color: C.violet, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
                Part {p.label}
              </div>
              <div style={{ background: C.ground, borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
                <p style={{ color: C.ink, fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>{p.clue}</p>
              </div>
              <input
                type="text"
                value={answers[i]}
                onChange={e => setAnswers(prev => prev.map((a, idx) => idx === i ? e.target.value : a))}
                placeholder="Answer…"
                style={{
                  border: `2px solid ${answers[i] ? C.violet : C.line}`,
                  borderRadius: 12,
                  background: C.panel,
                  color: C.ink,
                  fontSize: 16,
                  fontWeight: 500,
                  outline: 'none',
                  width: '100%',
                  padding: '12px 14px',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.14s',
                }}
              />
            </div>
          ))}
        </div>

        <div style={{ height: 100 }} />
      </div>

      <StickyBottom>
        <Btn onClick={() => go('submitted')} disabled={!anyFilled}>Submit Answers</Btn>
      </StickyBottom>
    </div>
  )
}

// ─── SCREEN 10 — RANKING ──────────────────────────────────────────────────────
function Ranking({ go }: { go: (s: PlayerScreen) => void }) {
  const [items, setItems] = useState(['Jupiter', 'Saturn', 'Uranus', 'Neptune'])

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    setItems(prev => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 2 of 6" question="Question 4 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <h2 style={{ color: C.ink, fontSize: 23, lineHeight: 1.3, fontWeight: 900, marginBottom: 6 }}>
          Arrange these planets from closest to furthest from the Sun.
        </h2>
        <p style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>Tap the arrows to put them in order.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item, i) => (
            <div key={item} style={{
              background: C.panel,
              border: `2px solid ${C.line}`,
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
            }}>
              <span style={{
                background: C.violet, color: '#fff', borderRadius: 10,
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 14, flexShrink: 0,
              }}>{i + 1}</span>
              <span style={{ color: C.ink, fontWeight: 600, fontSize: 17, flex: 1 }}>{item}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[{ dir: -1 as const, icon: '▲', disabled: i === 0 }, { dir: 1 as const, icon: '▼', disabled: i === items.length - 1 }].map(({ dir, icon, disabled }) => (
                  <button
                    key={icon}
                    onClick={() => move(i, dir)}
                    disabled={disabled}
                    style={{
                      background: disabled ? C.ground : C.violetPale,
                      color: disabled ? C.sub : C.violet,
                      border: 'none',
                      borderRadius: 8,
                      width: 34, height: 28,
                      fontSize: 12,
                      cursor: disabled ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.12s',
                      fontFamily: 'inherit',
                    }}
                  >{icon}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <StickyBottom>
        <Btn onClick={() => go('submitted')}>Lock In Order</Btn>
      </StickyBottom>
    </div>
  )
}

const DEMO_QUESTION = 'Which country has the longest coastline in the world?'

// ─── SCREEN 11 — SUBMITTED ────────────────────────────────────────────────────
function Submitted({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 2 of 6" question="Question 3 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        {/* Question retained for context */}
        <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>{DEMO_QUESTION}</p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <div style={{
            background: C.violetPale, borderRadius: 999,
            width: 60, height: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 26 }}>🔒</span>
          </div>

          <h1 style={{ color: C.ink, fontSize: 28 }} className="font-black">Answer locked in</h1>

          <div style={{
            background: C.ground, borderRadius: 16,
            border: `1px solid ${C.line}`,
            width: '100%',
            padding: '16px 20px',
          }}>
            <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Your answer
            </p>
            <p style={{ color: C.ink, fontSize: 22, fontWeight: 800 }}>Canada</p>
          </div>

          <WaitMsg msg="Waiting for the host…" />
          <p style={{ color: C.sub, fontSize: 14, marginTop: -8 }}>Your score: 14</p>

          <HostAdvance label="host reveals answer" to="correct" go={go} />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 12 — NO ANSWER ────────────────────────────────────────────────────
function NoAnswer({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} />

      <div className="flex-1 flex flex-col items-center justify-center">
        <div style={{
          background: C.cautionMist, borderRadius: 999,
          border: `2px solid ${C.cautionBorder}`,
          width: 64, height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20,
        }}>
          <span style={{ fontSize: 26 }}>⏱</span>
        </div>

        <h1 style={{ color: C.ink, fontSize: 26 }} className="font-black mb-3">Answers are closed</h1>

        <div style={{
          background: C.cautionMist, borderRadius: 14,
          border: `1px solid ${C.cautionBorder}`,
          padding: '12px 24px', marginBottom: 16,
        }}>
          <p style={{ color: C.caution, fontSize: 16, fontWeight: 700 }}>No answer submitted</p>
        </div>

        <p style={{ color: C.sub, fontSize: 14, marginBottom: 28 }}>This question will score 0 points.</p>

        <WaitMsg msg="Waiting for the answer…" />
      </div>
    </div>
  )
}

// ─── SCREEN 13 — CORRECT ──────────────────────────────────────────────────────
function Correct({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={15} round="Round 2 of 6" question="Question 3 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {/* Question retained for context */}
        <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>{DEMO_QUESTION}</p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{
            background: C.goMist, borderRadius: 999,
            border: `2px solid ${C.goBorder}`,
            width: 60, height: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 26, color: C.go }}>✓</span>
          </div>

          <h1 style={{ color: C.go, fontSize: 38 }} className="font-black">Correct!</h1>

          <div style={{
            background: C.panel, border: `1px solid ${C.line}`,
            borderRadius: 20, width: '100%',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
              <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Your answer</p>
              <p style={{ color: C.ink, fontSize: 18, fontWeight: 700 }}>Canada</p>
            </div>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
              <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Correct answer</p>
              <p style={{ color: C.go, fontSize: 18, fontWeight: 700 }}>Canada</p>
            </div>
            <div style={{ background: C.goMist, padding: '14px 20px', textAlign: 'center' }}>
              <p style={{ color: C.go, fontSize: 24, fontWeight: 900 }}>+1 point</p>
            </div>
          </div>

          <div style={{ background: C.violetPale, borderRadius: 14, width: '100%', padding: '12px 20px' }}>
            <p style={{ color: C.violet, fontSize: 28, fontWeight: 900 }}>15 points</p>
            <p style={{ color: C.sub, fontSize: 13 }}>Updated score</p>
          </div>

          <WaitMsg msg="Waiting for the next question…" />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <HostAdvance label="next question" to="single-answer" go={go} />
            <HostAdvance label="end of round" to="round-results" go={go} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 14 — INCORRECT ────────────────────────────────────────────────────
function Incorrect({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 2 of 6" question="Question 3 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {/* Question retained for context */}
        <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>{DEMO_QUESTION}</p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{
            background: C.stopMist, borderRadius: 999,
            border: `2px solid ${C.stopBorder}`,
            width: 60, height: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 24, color: C.stop }}>✕</span>
          </div>

          <h1 style={{ color: C.ink, fontSize: 38 }} className="font-black">Not quite</h1>

          <div style={{
            background: C.panel, border: `1px solid ${C.line}`,
            borderRadius: 20, width: '100%',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
              <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Your answer</p>
              <p style={{ color: C.ink, fontSize: 18, fontWeight: 700 }}>Russia</p>
            </div>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
              <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Correct answer</p>
              <p style={{ color: C.go, fontSize: 18, fontWeight: 700 }}>Canada</p>
            </div>
            <div style={{ background: C.ground, padding: '14px 20px', textAlign: 'center' }}>
              <p style={{ color: C.sub, fontSize: 20, fontWeight: 900 }}>0 points</p>
            </div>
          </div>

          <div style={{ background: C.ground, borderRadius: 14, border: `1px solid ${C.line}`, width: '100%', padding: '12px 20px' }}>
            <p style={{ color: C.ink, fontSize: 24, fontWeight: 800 }}>14 points</p>
            <p style={{ color: C.sub, fontSize: 13 }}>Your score</p>
          </div>

          <WaitMsg msg="Waiting for the next question…" />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 15 — CONTENT SCREEN ───────────────────────────────────────────────
function ContentScreen({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={28} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div style={{ background: C.violetPale, borderRadius: 24, width: 72, height: 72 }}
          className="flex items-center justify-center mb-6 shrink-0">
          <span style={{ fontSize: 32 }}>🍺</span>
        </div>
        <h1 style={{ color: C.ink, fontSize: 28, lineHeight: 1.2 }} className="font-black mb-4">
          Bar's open — back in 10 minutes!
        </h1>
        <p style={{ color: C.sub, fontSize: 16, lineHeight: 1.6, maxWidth: 280 }}>
          Grab a drink and we'll be back with Round 3 shortly.
        </p>
      </div>
    </div>
  )
}

// ─── SCREEN 16 — INTERMISSION ─────────────────────────────────────────────────
function Intermission({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={28} />

      <div className="flex-1 overflow-y-auto px-5 py-8">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <p style={{ color: C.sub, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Round 2 complete</p>
          <h1 style={{ color: C.ink, fontSize: 32 }} className="font-black">Intermission</h1>
          <p style={{ color: C.sub, fontSize: 15, marginTop: 8 }}>The next round will begin shortly.</p>
        </div>

        <div style={{ background: C.violetPale, borderRadius: 22, padding: '28px 24px', textAlign: 'center', marginBottom: 20 }}>
          <p style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Your score</p>
          <p style={{ color: C.violet, fontSize: 56, fontWeight: 900, lineHeight: 1 }}>28</p>
        </div>

        <button
          onClick={() => go('round-results')}
          style={{
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 16,
            width: '100%',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span style={{ color: C.ink, fontSize: 15, fontWeight: 600 }}>View leaderboard</span>
          <span style={{ color: C.violet, fontSize: 18 }}>→</span>
        </button>
      </div>
    </div>
  )
}

// ─── SCREEN 17 — ROUND RESULTS ────────────────────────────────────────────────
const LB_DATA = [
  { name: 'Quizteama Aguilera', score: 31 },
  { name: 'Risky Quizness', score: 30 },
  { name: 'Trivia Newton John', score: 28 },
  { name: 'Norfolk & Chance', score: 25 },
  { name: 'The Know-It-Alls', score: 20 },
]

function RoundResults({ go }: { go: (s: PlayerScreen) => void }) {
  const MY = 'Trivia Newton John'
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={28} />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <p style={{ color: C.sub, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Round 2 Complete</p>
          <div style={{ background: C.violetPale, borderRadius: 20, padding: '20px 24px' }}>
            <p style={{ color: C.violet, fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Trivia Newton John</p>
            <p style={{ color: C.ink, fontSize: 42, fontWeight: 900, lineHeight: 1, marginBottom: 4 }}>28</p>
            <p style={{ color: C.violet, fontSize: 15, fontWeight: 700 }}>3rd place</p>
          </div>
        </div>

        <p style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Leaderboard</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LB_DATA.map((t, i) => {
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

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <WaitMsg msg="Waiting for Round 3…" />
        </div>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <HostAdvance label="host starts next round" to="round-start" go={go} />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 18 — DELAYED REVEAL ───────────────────────────────────────────────
function DelayedReveal({ go }: { go: (s: PlayerScreen) => void }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={14} round="Round 2 — Answers" question="Question 1 of 5" />

      <div className="flex-1 px-5 py-6">
        <h2 style={{ color: C.ink, fontSize: 20, lineHeight: 1.35, fontWeight: 900, marginBottom: 20 }}>
          Which country has the longest coastline in the world?
        </h2>

        <div style={{ background: C.ground, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 18px', marginBottom: 16 }}>
          <p style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Your answer</p>
          <p style={{ color: C.ink, fontSize: 20, fontWeight: 800 }}>Canada</p>
        </div>

        {revealed ? (
          <>
            <div style={{ background: C.goMist, border: `1px solid ${C.goBorder}`, borderRadius: 14, padding: '14px 18px', marginBottom: 12 }}>
              <p style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Correct answer</p>
              <p style={{ color: C.go, fontSize: 20, fontWeight: 800 }}>Canada</p>
            </div>
            <div style={{ background: C.violetPale, borderRadius: 12, padding: '12px 18px', textAlign: 'center' }}>
              <p style={{ color: C.go, fontSize: 20, fontWeight: 900 }}>Correct! +1</p>
            </div>
          </>
        ) : (
          <div style={{ background: C.cautionMist, borderRadius: 14, border: `1px solid ${C.cautionBorder}`, padding: '12px 18px', textAlign: 'center' }}>
            <WaitMsg msg="Waiting for host to reveal…" />
          </div>
        )}

        {!revealed && (
          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <button
              onClick={() => setRevealed(true)}
              style={{ color: C.sub, fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
            >
              ↓ prototype: host reveals answer
            </button>
          </div>
        )}
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
          <p style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>You've won a $100 venue voucher!</p>
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

// ─── SCREEN 20 — FINAL RESULT (non-winner) ────────────────────────────────────
const NON_WINNER_LB = [
  { name: 'Quizteama Aguilera', score: 48 },
  { name: 'Risky Quizness', score: 43 },
  { name: 'Norfolk & Chance', score: 38 },
  { name: 'The Know-It-Alls', score: 34 },
  { name: 'Trivia Newton John', score: 28 },
]

function FinalResult({ go }: { go: (s: PlayerScreen) => void }) {
  const MY = 'Trivia Newton John'
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div style={{ background: C.ground, borderBottom: `1px solid ${C.line}`, padding: '24px 24px 28px', textAlign: 'center', flexShrink: 0 }}>
        <p style={{ color: C.sub, fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Game Complete</p>
        <p style={{ color: C.ink, fontSize: 19, fontWeight: 800, marginBottom: 16 }}>Trivia Newton John</p>
        <div style={{ background: C.panel, borderRadius: 18, border: `1px solid ${C.line}`, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', padding: '20px 40px' }}>
          <p style={{ color: C.sub, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>You finished</p>
          <p style={{ color: C.ink, fontSize: 54, fontWeight: 900, lineHeight: 1, marginTop: 4 }}>5th</p>
          <p style={{ color: C.sub, fontSize: 13, marginTop: 4 }}>Final score: 28</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <p style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Final Standings</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {NON_WINNER_LB.map((t, i) => {
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
        <p style={{ color: C.sub, fontSize: 14, textAlign: 'center', marginTop: 24 }}>Thanks for playing!</p>
      </div>
    </div>
  )
}

// ─── SCREEN 21 — RECONNECTING ─────────────────────────────────────────────────
function Reconnecting({ go }: { go: (s: PlayerScreen) => void }) {
  const [back, setBack] = useState(false)
  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: '100%' }}>
      {back ? (
        <>
          <div style={{ background: C.goMist, borderRadius: 999, border: `2px solid ${C.goBorder}`, width: 64, height: 64 }}
            className="flex items-center justify-center mb-5">
            <span style={{ fontSize: 28, color: C.go }}>✓</span>
          </div>
          <h1 style={{ color: C.go, fontSize: 30 }} className="font-black mb-2">You're back!</h1>
          <p style={{ color: C.sub, fontSize: 15 }}>Returning to the game…</p>
        </>
      ) : (
        <>
          <div className="animate-spin" style={{
            borderRadius: 999,
            width: 56, height: 56,
            border: `3px solid ${C.line}`,
            borderTopColor: C.violet,
            marginBottom: 20,
          }} />
          <h1 style={{ color: C.ink, fontSize: 26 }} className="font-black mb-2">Trying to reconnect…</h1>
          <p style={{ color: C.sub, fontSize: 15, marginBottom: 32 }}>Your answer and team are safe.</p>
          <button
            onClick={() => setBack(true)}
            style={{ color: C.sub, fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
          >
            ↓ prototype: simulate reconnect
          </button>
        </>
      )}
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

// ─── SCREEN 13b — PARTIAL CREDIT ─────────────────────────────────────────────
const BENELUX_Q = 'Name the three countries of Benelux.'
const PARTIAL_ROWS = [
  { answer: 'Belgium', submitted: 'Belgium', correct: true },
  { answer: 'Netherlands', submitted: 'The Netherlands', correct: true },
  { answer: 'Luxembourg', submitted: 'France', correct: false },
]

function PartialCorrect({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={18} round="Round 2 of 6" question="Question 5 of 5" />

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>{BENELUX_Q}</p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{
            background: C.goMist, borderRadius: 999,
            border: `2px solid ${C.goBorder}`,
            width: 60, height: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 24, color: C.go }}>½</span>
          </div>

          <div>
            <h1 style={{ color: C.ink, fontSize: 30, textAlign: 'center' }} className="font-black">2 of 3 correct</h1>
            <p style={{ color: C.go, fontSize: 18, fontWeight: 700, textAlign: 'center', marginTop: 2 }}>+2 points</p>
          </div>

          {/* Per-answer result rows */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PARTIAL_ROWS.map((row, i) => (
              <div key={i} style={{
                background: row.correct ? C.goMist : C.stopMist,
                border: `1px solid ${row.correct ? C.goBorder : C.stopBorder}`,
                borderRadius: 14,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <span style={{ fontSize: 18, color: row.correct ? C.go : C.stop, flexShrink: 0 }}>
                  {row.correct ? '✓' : '✕'}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                    Answer {i + 1}
                  </p>
                  <p style={{ color: C.ink, fontSize: 15, fontWeight: 600 }}>
                    {row.submitted}
                    {!row.correct && (
                      <span style={{ color: C.go, fontWeight: 500, fontSize: 13, marginLeft: 8 }}>
                        → {row.answer}
                      </span>
                    )}
                  </p>
                </div>
                <span style={{ color: row.correct ? C.go : C.sub, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                  {row.correct ? '+1' : '+0'}
                </span>
              </div>
            ))}
          </div>

          <div style={{ background: C.violetPale, borderRadius: 14, width: '100%', padding: '12px 20px' }}>
            <p style={{ color: C.violet, fontSize: 26, fontWeight: 900 }}>18 points</p>
            <p style={{ color: C.sub, fontSize: 13 }}>Updated score</p>
          </div>

          <WaitMsg msg="Waiting for the next question…" />
          <HostAdvance label="end of round" to="round-results" go={go} />
        </div>
      </div>
    </div>
  )
}

// ─── SCREEN 17b — ROUND RESULTS (LEADERBOARD HIDDEN) ─────────────────────────
function RoundResultsHidden({ go }: { go: (s: PlayerScreen) => void }) {
  return (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <TopBar team="Trivia Newton John" score={28} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <p style={{ color: C.sub, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Round 2 Complete</p>

        <div style={{ background: C.violetPale, borderRadius: 24, width: '100%', maxWidth: 300, padding: '32px 24px', marginBottom: 24 }}>
          <p style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Your score</p>
          <p style={{ color: C.violet, fontSize: 60, fontWeight: 900, lineHeight: 1 }}>28</p>
        </div>

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
            Standings aren't being shown right now.
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
    case 'round-start':    return <RoundStart go={go} />
    case 'single-answer':  return <SingleAnswer go={go} />
    case 'image-question': return <ImageQuestion go={go} />
    case 'multiple-choice':return <MultipleChoice go={go} />
    case 'multi-answer':   return <MultiAnswer go={go} />
    case 'multi-part':     return <MultiPart go={go} />
    case 'ranking':        return <Ranking go={go} />
    case 'submitted':      return <Submitted go={go} />
    case 'no-answer':      return <NoAnswer go={go} />
    case 'correct':        return <Correct go={go} />
    case 'incorrect':            return <Incorrect go={go} />
    case 'partial-correct':      return <PartialCorrect go={go} />
    case 'content-screen':       return <ContentScreen go={go} />
    case 'intermission':   return <Intermission go={go} />
    case 'round-results':         return <RoundResults go={go} />
    case 'round-results-hidden':  return <RoundResultsHidden go={go} />
    case 'delayed-reveal': return <DelayedReveal go={go} />
    case 'winner':         return <Winner go={go} />
    case 'final-result':   return <FinalResult go={go} />
    case 'reconnecting':   return <Reconnecting go={go} />
    case 'game-ended':     return <GameEnded go={go} />
  }
}


export function PlayerFlow() {
  const [screen, setScreen] = useState<PlayerScreen>('join')

  function go(nextScreen: PlayerScreen) {
    setScreen(nextScreen)
  }

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
        {renderScreen(screen, go)}
      </div>
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
            {renderScreen(screen, go)}
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
