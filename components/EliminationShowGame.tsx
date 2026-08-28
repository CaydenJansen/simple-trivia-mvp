"use client";

import type { EliminationShowGameState, EliminationShowGameType } from '@/lib/trivia/elimination-show-games'

type ArenaTeam = { id: string; name: string }

export default function EliminationShowGame({
  type,
  teams,
  state,
  ownTeamId = null,
  ownChoice = null,
  canChoose = false,
  choosing = false,
  secondsRemaining = 0,
  onChoose,
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
  onChoose?: (choice: string) => void
  dark?: boolean
}) {
  const alive = new Set(state.aliveTeamIds)
  const justEliminated = new Set(state.roundEliminatedTeamIds)
  const panel = dark ? '#181329' : '#FFFFFF'
  const line = dark ? '#302A49' : '#E8E5F4'
  const text = dark ? '#F4F1FF' : '#18171F'
  const dim = dark ? '#A9A4BF' : '#6D687F'

  if (type === 'heads-or-tails') {
    const revealed = state.roundPhase === 'reveal'
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
            {revealed ? `${state.roundOutcome === 'heads' ? 'Heads' : 'Tails'} wins this flip` : `Choices lock in ${secondsRemaining}s`}
          </p>
        </div>

        {ownTeamId && canChoose && !revealed && (
          <div className="mx-auto mt-5 grid max-w-sm grid-cols-2 gap-3">
            {(['heads', 'tails'] as const).map(choice => (
              <button key={choice} type="button" disabled={choosing} onClick={() => onChoose?.(choice)}
                style={{ background: ownChoice === choice ? '#7C3AED' : panel, color: ownChoice === choice ? 'white' : text, border: `2px solid ${ownChoice === choice ? '#7C3AED' : line}` }}
                className="cursor-pointer rounded-2xl px-5 py-4 text-lg font-black capitalize transition active:scale-95 disabled:opacity-60">
                {choice}
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {teams.map(team => {
            const eliminated = !alive.has(team.id)
            return <div key={team.id} style={{ background: panel, border: `1px solid ${justEliminated.has(team.id) ? '#EF4444' : line}`, opacity: eliminated && !justEliminated.has(team.id) ? 0.38 : 1 }} className="flex items-center justify-between rounded-xl px-4 py-2.5 text-left">
              <span style={{ color: text }} className="truncate text-sm font-bold">{team.name}</span>
              <span style={{ color: eliminated ? '#F87171' : '#34D399' }} className="ml-2 text-[10px] font-black uppercase">{eliminated ? 'Out' : 'In'}</span>
            </div>
          })}
        </div>
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
        {rockLane >= 0 && <div aria-label={`Rock falling into lane ${rockLane + 1}`} className="rock-drop absolute top-2 z-20 -translate-x-1/2 text-6xl" style={{ left: `${(rockLane + 0.5) * 33.333}%` }}>🪨</div>}
        {teams.filter(team => alive.has(team.id)).map((team, index) => {
          const lane = state.positions[team.id] ?? 1
          const own = team.id === ownTeamId
          return <div key={team.id} title={team.name} className="pointer-events-none absolute top-[58%] z-10 -translate-x-1/2 -translate-y-1/2 transition-[left,opacity,transform] duration-300 ease-out"
            style={{ left: `${(lane + 0.5) * 33.333}%`, marginTop: (index % 4) * 10 - 15, opacity: own ? 1 : 0.56 }}>
            <div style={{ background: own ? '#7C3AED' : dark ? '#817A99' : '#9CA3AF', color: 'white', border: own ? '3px solid #C4B5FD' : '2px solid rgba(255,255,255,.75)' }} className={`${own ? 'h-12 w-12 text-xl' : 'h-8 w-8 text-sm'} flex items-center justify-center rounded-full font-black shadow-lg`}>{team.name.slice(0, 1).toUpperCase()}</div>
            <p style={{ color: text }} className={`${own ? 'max-w-28 font-black' : 'max-w-20'} mt-1 truncate text-center text-[10px]`}>{team.name}</p>
          </div>
        })}
      </div>
      {ownTeamId && canChoose && state.roundPhase === 'choosing' && alive.has(ownTeamId) && <p style={{ color: dim }} className="mt-3 text-center text-xs font-semibold">Tap a lane to move there. Your position locks when the timer ends.</p>}
    </div>
  )
}
