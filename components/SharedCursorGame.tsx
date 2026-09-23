'use client'

import { useEffect, useState } from 'react'
import { sharedCursorState } from '@/lib/trivia/collaborative-show-games'
import type { Json } from '@/lib/supabase/database.types'

type Team = { id: string; name: string }

export default function SharedCursorGame({ teams, settings, ownTeamId, dark = false }: {
  teams: Team[]
  settings: Json
  ownTeamId?: string | null
  dark?: boolean
}) {
  const state = sharedCursorState(settings)
  const candidateName = teams.find(team => team.id === state.candidateTeamId)?.name
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!state.candidateTeamId || !state.candidateSince) return
    const timer = window.setInterval(() => setNow(Date.now()), 50)
    return () => window.clearInterval(timer)
  }, [state.candidateSince, state.candidateTeamId])
  const candidateProgress = state.candidateSince ? Math.max(0, Math.min(100, ((now - state.candidateSince) / 1000) * 100)) : 0
  const fallbackPositions = Object.fromEntries(teams.map((team, index) => {
    const angle = (index / Math.max(1, teams.length)) * Math.PI * 2 - Math.PI / 2
    return [team.id, { x: Math.cos(angle), y: Math.sin(angle) }]
  }))
  const positions = Object.keys(state.positions).length ? state.positions : fallbackPositions

  return <div className="mx-auto w-full max-w-2xl">
    <div style={{ background: dark ? '#17142b' : '#f5f1ff', border: `1px solid ${dark ? '#393251' : '#ddd2ff'}` }} className="relative mx-auto aspect-square w-full max-w-[430px] overflow-hidden rounded-full">
      <div className="absolute inset-[13%] rounded-full border border-dashed opacity-40" />
      {teams.map(team => {
        const point = positions[team.id] ?? { x: 0, y: 0 }
        const own = team.id === ownTeamId
        const candidate = team.id === state.candidateTeamId
        return <div key={team.id} style={{ left: `${50 + point.x * 39}%`, top: `${50 + point.y * 39}%`, transform: 'translate(-50%, -50%)', background: candidate ? '#10b981' : own ? '#7c3aed' : dark ? '#29233f' : '#fff', color: candidate || own ? '#fff' : dark ? '#f4f0ff' : '#24212b', border: `2px solid ${candidate ? '#6ee7b7' : own ? '#a78bfa' : dark ? '#4a4264' : '#ddd6eb'}` }} className="absolute z-10 max-w-[28%] truncate rounded-full px-3 py-2 text-center text-xs font-black shadow-lg">
          {team.name}
        </div>
      })}
      {state.candidateTeamId && <div aria-hidden="true" style={{ left: `${50 + state.x * 39}%`, top: `${50 + state.y * 39}%`, transform: 'translate(-50%, -50%)', background: `conic-gradient(#10b981 ${candidateProgress}%, transparent ${candidateProgress}%)` }} className="absolute z-[19] h-16 w-16 rounded-full transition-[left,top] duration-200 ease-out" />}
      <div
        aria-label="Shared mouse cursor"
        style={{ left: `${50 + state.x * 39}%`, top: `${50 + state.y * 39}%`, transform: 'translate(-18%, -12%)', filter: 'drop-shadow(0 7px 9px rgba(35,20,70,.35))' }}
        className="absolute z-20 h-12 w-12 transition-[left,top] duration-200 ease-out"
      >
        <svg viewBox="0 0 48 48" role="img" aria-hidden="true" className="h-full w-full overflow-visible">
          <path d="M6 3.5 38.5 28l-15.1 2.2 8.6 13-7.2 4.3-8.1-13.1L6 45.5Z" fill={state.candidateTeamId ? '#fbbf24' : '#ffffff'} stroke="#6d28d9" strokeWidth="3.5" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
    <p className={`mt-3 text-center text-sm font-black ${candidateName ? 'text-emerald-400' : dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
      {candidateName ? `Locking onto ${candidateName}… hold it there!` : 'TAP your button to nudge the cursor. Do not drag it.'}
    </p>
  </div>
}
