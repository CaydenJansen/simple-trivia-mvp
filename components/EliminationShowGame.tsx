"use client";

import { useEffect, useState } from 'react'
import type { EliminationShowGameState, EliminationShowGameType } from '@/lib/trivia/elimination-show-games'

type ArenaTeam = { id: string; name: string }

function RemainingTeamList({ teams, panel, line, text, dim }: { teams: ArenaTeam[]; panel: string; line: string; text: string; dim: string }) {
  return <div style={{ background: panel, border: `1px solid ${line}` }} className="mt-5 rounded-2xl px-4 py-4 text-left">
    <p style={{ color: dim }} className="text-[10px] font-black uppercase tracking-[0.18em]">Teams remaining · {teams.length}</p>
    <div className="mt-3 flex flex-wrap gap-2">{teams.map(team => <span key={team.id} style={{ color: text, border: `1px solid ${line}` }} className="rounded-full px-3 py-1.5 text-xs font-bold">{team.name}</span>)}</div>
  </div>
}

export default function EliminationShowGame({
  type,
  teams,
  state,
  ownTeamId = null,
  ownChoice = null,
  canChoose = false,
  choosing = false,
  secondsRemaining = 0,
  choicesByTeam = {},
  finished = false,
  onChoose,
  onRevealAnimationComplete,
  dark = false,
}: {
  type: EliminationShowGameType
  teams: ArenaTeam[]
  state: EliminationShowGameState
  ownTeamId?: string | null
  ownChoice?: string | null
  canChoose?: boolean
  choosing?: boolean
  secondsRemaining?: number
  choiceCounts?: Record<string, number>
  choicesByTeam?: Record<string, string>
  finished?: boolean
  onChoose?: (choice: string) => void
  onRevealAnimationComplete?: (roundNumber: number) => void
  dark?: boolean
}) {
  const [announcedCoinRound, setAnnouncedCoinRound] = useState<number | null>(null)
  const alive = new Set(state.aliveTeamIds)
  const panel = dark ? '#181329' : '#FFFFFF'
  const line = dark ? '#302A49' : '#E8E5F4'
  const text = dark ? '#F4F1FF' : '#18171F'
  const dim = dark ? '#A9A4BF' : '#6D687F'
  const remainingTeams = teams.filter(team => alive.has(team.id))

  useEffect(() => {
    if (type !== 'heads-or-tails' || state.roundPhase !== 'reveal') return
    const timer = window.setTimeout(() => {
      setAnnouncedCoinRound(state.roundNumber)
      onRevealAnimationComplete?.(state.roundNumber)
    }, 1150)
    return () => window.clearTimeout(timer)
  }, [onRevealAnimationComplete, state.roundNumber, state.roundPhase, state.roundOutcome, type])

  if (type === 'heads-or-tails') {
    const revealed = state.roundPhase === 'reveal'
    const resultVisible = !revealed || announcedCoinRound === state.roundNumber
    return (
      <div className="mx-auto mt-6 w-full max-w-2xl">
        <div className="text-center">
          <div className="coin-stage mx-auto h-28 w-28" aria-label={revealed ? `${state.roundOutcome === 'heads' ? 'Heads' : 'Tails'} coin` : 'Coin waiting to flip'}>
            <div className={`coin-flip h-full w-full ${revealed ? (state.roundOutcome === 'heads' ? 'coin-reveal-heads' : 'coin-reveal-tails') : 'coin-waiting'}`}>
              <span className="coin-face coin-heads">H</span>
              <span className="coin-face coin-tails">T</span>
            </div>
          </div>
          <p style={{ color: dim }} className="mt-3 text-sm font-bold">
            {revealed ? announcedCoinRound === state.roundNumber ? `${state.roundOutcome === 'heads' ? 'Heads' : 'Tails'} wins this flip` : 'Flipping…' : `Choices lock in ${secondsRemaining}s`}
          </p>
        </div>

        <p style={{ color: dim }} className="mb-2 mt-5 text-center text-xs font-black uppercase tracking-widest">Call the next flip</p>
        <div className="grid grid-cols-2 gap-3">
          {(['heads', 'tails'] as const).map(choice => {
            const occupants = remainingTeams.filter(team => (choicesByTeam[team.id] ?? (team.id === ownTeamId ? ownChoice : null)) === choice)
            const selected = ownChoice === choice
            return <button key={choice} type="button" disabled={!ownTeamId || !canChoose || choosing || revealed || !alive.has(ownTeamId)} onClick={() => onChoose?.(choice)}
              style={{ background: selected ? 'rgba(124,58,237,.18)' : panel, color: text, border: `2px solid ${selected ? '#7C3AED' : line}` }}
              className="min-h-36 cursor-pointer rounded-2xl p-3 text-left transition active:scale-[.98] disabled:cursor-default disabled:opacity-100">
              <span className="block text-center text-lg font-black capitalize">{choice === 'heads' ? 'H · Heads' : 'T · Tails'}</span>
              <span className="mt-3 flex flex-wrap justify-center gap-1.5">
                {occupants.map(team => <span key={team.id} title={team.name} style={{ background: team.id === ownTeamId ? '#7C3AED' : dark ? '#302A49' : '#EEEAF8', color: team.id === ownTeamId ? 'white' : text }} className="max-w-full truncate rounded-full px-2.5 py-1 text-[10px] font-black">{team.name}</span>)}
              </span>
              {occupants.length === 0 && <span style={{ color: dim }} className="mt-5 block text-center text-xs font-bold">No calls yet</span>}
            </button>
          })}
        </div>
        {!revealed && ownTeamId && alive.has(ownTeamId) && <p style={{ color: dim }} className="mt-3 text-center text-xs font-semibold">Tap either side to move your team. Choices lock in {secondsRemaining}s.</p>}
        {resultVisible && <RemainingTeamList teams={remainingTeams} panel={panel} line={line} text={text} dim={dim} />}
      </div>
    )
  }

  if (type === 'scissors-paper-rock') {
    const revealed = state.roundPhase === 'reveal'
    const ownMatchup = ownTeamId
      ? state.matchups.find(matchup => matchup.teamAId === ownTeamId || matchup.teamBId === ownTeamId) ?? null
      : null
    const opponentId = ownMatchup && ownTeamId
      ? ownMatchup.teamAId === ownTeamId ? ownMatchup.teamBId : ownMatchup.teamAId
      : null
    const opponent = teams.find(team => team.id === opponentId) ?? null
    const ownHasBye = Boolean(ownTeamId && state.byeTeamId === ownTeamId)
    const ownIsAlive = Boolean(ownTeamId && alive.has(ownTeamId))
    const choices = [
      { value: 'scissors', emoji: '✂️', label: 'Scissors' },
      { value: 'paper', emoji: '📄', label: 'Paper' },
      { value: 'rock', emoji: '🪨', label: 'Rock' },
    ] as const
    const choiceDisplay = (choice: string | undefined) => choices.find(item => item.value === choice)?.emoji ?? '—'
    const bothAdvance = Boolean(ownIsAlive && opponentId && alive.has(opponentId))

    return (
      <div className="mx-auto mt-6 w-full max-w-2xl">
        {ownTeamId ? (
          <>
            {ownHasBye ? (
              <div style={{ background: panel, border: `1px solid ${line}` }} className="rounded-2xl px-5 py-6 text-center">
                <p className="text-4xl">🍀</p>
                <h2 style={{ color: text }} className="mt-3 text-2xl font-black">Lucky you!</h2>
                <p style={{ color: dim }} className="mt-2 text-sm font-semibold leading-6">There aren’t enough teams for you to have an opponent. You’re through to the next round.</p>
              </div>
            ) : ownMatchup ? (
              <>
                <div style={{ background: panel, border: `1px solid ${line}` }} className="rounded-2xl px-5 py-4 text-center">
                  <p style={{ color: dim }} className="text-[10px] font-black uppercase tracking-[0.18em]">Your opponent</p>
                  <p style={{ color: text }} className="mt-1 truncate text-2xl font-black">{opponent?.name ?? 'Another team'}</p>
                </div>
                {!revealed && ownIsAlive && <>
                  <p style={{ color: secondsRemaining <= 2 ? '#EF4444' : dim }} className="mt-4 text-center text-sm font-black">Choose in {secondsRemaining}s</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {choices.map(choice => <button key={choice.value} type="button" disabled={!canChoose || choosing} onClick={() => onChoose?.(choice.value)}
                      style={{ background: ownChoice === choice.value ? '#7C3AED' : panel, color: ownChoice === choice.value ? 'white' : text, border: `2px solid ${ownChoice === choice.value ? '#7C3AED' : line}` }}
                      className="cursor-pointer rounded-2xl px-2 py-4 font-black transition active:scale-95 disabled:opacity-60">
                      <span className="block text-3xl">{choice.emoji}</span>
                      <span className="mt-2 block text-xs sm:text-sm">{choice.label}</span>
                    </button>)}
                  </div>
                  <p style={{ color: dim }} className="mt-3 text-xs font-semibold">Your latest choice is locked when the timer reaches zero.</p>
                </>}
                {revealed && <div className="mt-5 text-center">
                  <div style={{ background: panel, border: `1px solid ${line}` }} className="mx-auto mb-4 flex max-w-sm items-center justify-center gap-5 rounded-xl px-4 py-3">
                    <span style={{ color: text }} className="text-sm font-black">You {choiceDisplay(choicesByTeam[ownTeamId ?? ''])}</span>
                    <span style={{ color: dim }} className="text-xs font-black">VS</span>
                    <span style={{ color: text }} className="text-sm font-black">{choiceDisplay(choicesByTeam[opponentId ?? ''])} {opponent?.name ?? 'Opponent'}</span>
                  </div>
                  <h2 style={{ color: ownIsAlive ? '#10B981' : '#EF4444' }} className="text-3xl font-black">
                    {finished ? ownIsAlive ? 'You won!' : 'Another team won' : bothAdvance ? 'You’re both through!' : ownIsAlive ? `You knocked out ${opponent?.name ?? 'the other team'}!` : 'You were eliminated'}
                  </h2>
                  <p style={{ color: dim }} className="mt-2 text-sm font-semibold">{finished ? 'Waiting for the host to continue…' : ownIsAlive ? 'The remaining teams will be paired again for the next round.' : 'Watch the remaining teams battle it out.'}</p>
                </div>}
              </>
            ) : (
              <p style={{ color: dim }} className="text-center text-sm font-bold">Pairing the next round…</p>
            )}

            {!ownIsAlive && <RemainingTeamList teams={remainingTeams} panel={panel} line={line} text={text} dim={dim} />}
          </>
        ) : (
          <>
            <p style={{ color: dim }} className="mb-3 text-center text-sm font-bold">{revealed ? `Round ${state.roundNumber} results` : `Choices lock in ${secondsRemaining}s`}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {state.matchups.map((matchup, index) => {
                const teamA = teams.find(team => team.id === matchup.teamAId)
                const teamB = teams.find(team => team.id === matchup.teamBId)
                return <div key={`${matchup.teamAId}:${matchup.teamBId}`} style={{ background: panel, border: `1px solid ${line}` }} className="rounded-2xl px-4 py-4 text-left">
                  <p style={{ color: dim }} className="text-[10px] font-black uppercase tracking-widest">Match {index + 1}</p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span style={{ color: alive.has(matchup.teamAId) ? text : '#F87171' }} className="min-w-0 flex-1 truncate font-black">{teamA?.name ?? 'Team'}</span>
                    <span style={{ color: dim }} className="text-xs font-black">VS</span>
                    <span style={{ color: alive.has(matchup.teamBId) ? text : '#F87171' }} className="min-w-0 flex-1 truncate text-right font-black">{teamB?.name ?? 'Team'}</span>
                  </div>
                </div>
              })}
              {state.byeTeamId && <div style={{ background: panel, border: `1px solid ${line}` }} className="rounded-2xl px-4 py-4 text-left">
                <p style={{ color: dim }} className="text-[10px] font-black uppercase tracking-widest">Bye this round</p>
                <p style={{ color: text }} className="mt-2 truncate font-black">🍀 {teams.find(team => team.id === state.byeTeamId)?.name ?? 'Team'}</p>
              </div>}
            </div>
            <RemainingTeamList teams={remainingTeams} panel={panel} line={line} text={text} dim={dim} />
          </>
        )}
      </div>
    )
  }

  const rockLane = state.roundPhase === 'reveal' && state.roundOutcome !== null ? Number(state.roundOutcome) : -1
  return (
    <div className="mx-auto mt-6 w-full max-w-2xl">
      <p style={{ color: dim }} className="mb-3 text-center text-sm font-bold">
        {state.roundPhase === 'choosing' ? `Positions lock in ${secondsRemaining}s` : 'Positions locked—the rock is falling!'}
      </p>
      <div style={{ background: panel, border: `1px solid ${line}` }} className="relative h-56 overflow-hidden rounded-3xl">
        {[0, 1, 2].map(lane => <button key={lane} type="button" disabled={!ownTeamId || !canChoose || choosing || state.roundPhase !== 'choosing' || !alive.has(ownTeamId)} onClick={() => onChoose?.(String(lane))}
          aria-label={`Move to lane ${lane + 1}`}
          style={{ left: `${lane * 33.333}%`, borderRight: lane < 2 ? `1px dashed ${line}` : undefined, background: ownTeamId && (state.positions[ownTeamId] ?? 1) === lane ? 'rgba(124,58,237,.09)' : 'transparent' }}
          className={`absolute inset-y-0 w-1/3 border-0 transition-colors ${ownTeamId && canChoose ? 'cursor-pointer hover:bg-violet-500/10' : 'cursor-default'}`}>
          <span style={{ color: dim }} className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-black uppercase">Lane {lane + 1}</span>
        </button>)}
        {rockLane >= 0 && <div className="pointer-events-none absolute inset-0 z-20 grid grid-cols-3" aria-label={`Rock falling into lane ${rockLane + 1}`}>
          <div className="flex justify-center" style={{ gridColumn: rockLane + 1 }}><span className="rock-drop block text-6xl">🪨</span></div>
        </div>}
        {teams.filter(team => alive.has(team.id)).map((team, index) => {
          const lane = state.positions[team.id] ?? 1
          const own = team.id === ownTeamId
          return <div key={team.id} title={team.name} className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-[left,top,opacity,transform] duration-300 ease-out"
            style={{ left: `${(lane + 0.5) * 33.333}%`, top: own ? '38%' : `${62 + (index % 3) * 7}%`, marginLeft: own ? 0 : ((index % 3) - 1) * 24, opacity: own ? 1 : 0.56 }}>
            <div style={{ background: own ? '#7C3AED' : dark ? '#817A99' : '#9CA3AF', color: 'white', border: own ? '3px solid #C4B5FD' : '2px solid rgba(255,255,255,.75)' }} className={`${own ? 'h-12 w-12 text-xl' : 'h-8 w-8 text-sm'} flex items-center justify-center rounded-full font-black shadow-lg`}>{team.name.slice(0, 1).toUpperCase()}</div>
            <p style={{ color: text }} className={`${own ? 'max-w-28 font-black' : 'max-w-20'} mt-1 truncate text-center text-[10px]`}>{team.name}</p>
          </div>
        })}
      </div>
      {ownTeamId && canChoose && state.roundPhase === 'choosing' && alive.has(ownTeamId) && <p style={{ color: dim }} className="mt-3 text-center text-xs font-semibold">Tap a lane to move there. Your position locks when the timer ends.</p>}
    </div>
  )
}
