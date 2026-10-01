"use client";

import { useRef, useState } from 'react'
import type { Json } from '@/lib/supabase/database.types'
import { hotPotatoHeat, hotPotatoPending, hotPotatoState } from '@/lib/trivia/hot-potato'

type Props = {
  settings: Json; now: number; endsAt: string | null; finished: boolean
  ownTeamId?: string | null; dark?: boolean
  onPass?: (potatoId: string, recipientId: string, operationId: string) => Promise<string>
}

export default function HotPotatoGame({ settings, now, endsAt, finished, ownTeamId, dark = false, onPass }: Props) {
  const state = hotPotatoState(settings)
  const own = state.teams.find(team => team.id === ownTeamId)
  const held = state.potatoes.filter(potato => potato.holder_id === ownTeamId)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const retry = useRef<{ potato: string; recipient: string; operation: string } | null>(null)
  const [feedback, setFeedback] = useState('')
  const potato = held.find(item => item.id === selected) ?? held[0]
  const deadline = endsAt ? Date.parse(endsAt) : now
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
  const closed = finished || seconds === 0
  const fresh = state.sampledAt > 0 && now - state.sampledAt < 5000
  const panel = dark ? 'border-white/15 bg-white/5' : 'border-violet-100 bg-white'
  const muted = dark ? 'text-violet-200' : 'text-zinc-600'
  const pending = own ? hotPotatoPending(own, state, now, deadline, finished) : 0
  async function pass(recipient: string) {
    if (!potato || !onPass || busyRef.current || closed || !fresh) return
    const action = retry.current?.potato === potato.id && retry.current.recipient === recipient ? retry.current : { potato: potato.id, recipient, operation: crypto.randomUUID() }
    retry.current = action
    busyRef.current = true; setBusy(true); setFeedback('')
    try {
      const outcome = await onPass(action.potato, action.recipient, action.operation)
      retry.current = null
      setFeedback(outcome === 'passed' || outcome === 'already-passed' ? 'Passed! Your points bank when you have no potatoes left.' : outcome === 'too-soon' ? 'Just caught it—try passing again in a moment.' : outcome === 'closed' ? 'Time’s up! Checking the final scores…' : 'That potato already exploded or moved. Pick one you’re holding now.')
    } catch { setFeedback('Pass not confirmed. Try again—we’ll check the same pass without sending it twice.') }
    finally { busyRef.current = false; setBusy(false) }
  }
  return <div className={`mx-auto mt-4 w-full max-w-3xl text-left ${dark ? 'text-white' : 'text-zinc-900'}`}>
    <div className="flex items-center justify-between gap-3 text-sm font-black"><span>{finished ? 'Final Hot Potato scores' : 'Hot Potato scores · not quiz points'}</span><span role="timer" className={seconds <= 10 ? 'text-red-500' : 'text-violet-500'}>{finished ? 'Finished' : `${seconds}s`}</span></div>
    {own && <>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className={`rounded-xl border p-3 ${panel}`}><p className={`text-xs font-bold ${muted}`}>Banked · safe</p><p className="text-2xl font-black tabular-nums text-emerald-500">{own.banked.toFixed(1)}</p></div>
        <div className={`rounded-xl border p-3 ${panel}`}><p className={`text-xs font-bold ${muted}`}>Pending · at risk</p><p className="text-2xl font-black tabular-nums text-amber-500">{pending.toFixed(1)}</p></div>
      </div>
      {!closed && <div className="mt-3">
        <div className="flex flex-wrap gap-2">{held.map(item => <button key={item.id} type="button" onClick={() => setSelected(item.id)} aria-label={`Select potato ${held.indexOf(item) + 1}`} aria-pressed={potato?.id === item.id} className={`rounded-xl border-2 px-4 py-2 ${potato?.id === item.id ? 'border-violet-500 bg-violet-500/15' : 'border-transparent'}`}>
          <span className="inline-block text-3xl motion-reduce:!animate-none" style={{ animation: `potato-wobble ${0.65 - hotPotatoHeat(item.born_at, now) * 0.52}s infinite alternate` }}>🥔</span>
        </button>)}</div>
        <p className={`mt-1 text-sm font-semibold ${muted}`}>{held.length ? `${held.length} potato${held.length === 1 ? '' : 'es'} · +${held.length} point${held.length === 1 ? '' : 's'}/second. Pass them all to bank.` : 'No potatoes right now. Watch who’s holding them!'}</p>
        {own.bursts > 0 && <p className="mt-1 text-xs font-bold text-orange-500">💥 {own.bursts} explosion{own.bursts === 1 ? '' : 's'} · pending points were lost, banked points are safe.</p>}
      </div>}
    </>}
    {!fresh && !closed && <p role="status" className="mt-2 text-sm font-bold text-orange-500">Reconnecting… scores will catch up automatically.</p>}
    {feedback && <p role="status" className={`mt-2 text-sm font-semibold ${muted}`}>{feedback}</p>}
    {!closed && own && held.length > 0 && <p className="mt-3 text-sm font-black">Pass {held.length > 1 ? 'the selected potato' : 'your potato'} to:</p>}
    <label className={`mt-3 block text-xs font-bold ${muted}`}>Find a team<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search team names" className={`mt-1 w-full rounded-xl border px-3 py-2 text-base ${panel}`} /></label>
    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto overscroll-contain" aria-label="Teams and potatoes">
      {[...state.teams].sort((a, b) => Number(a.id === ownTeamId) - Number(b.id === ownTeamId)).filter(team => team.name.toLowerCase().includes(search.toLowerCase())).map(team => {
        const count = state.potatoes.filter(item => item.holder_id === team.id).length
        return <div key={team.id} className={`flex items-center gap-2 rounded-xl border p-3 ${panel}`}>
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-black">{team.name}{team.id === ownTeamId ? ' (you)' : ''}</p><p className={`text-xs tabular-nums ${muted}`}>{team.banked.toFixed(1)} banked · {hotPotatoPending(team, state, now, deadline, finished).toFixed(1)} pending</p></div>
          <span className="shrink-0 text-sm" aria-label={`${team.name} holds ${count} potatoes`}>{count ? `🥔 ×${count}` : '—'}</span>
          {onPass && own && team.id !== ownTeamId && held.length > 0 && !closed && <button type="button" aria-label={`Pass to ${team.name}`} disabled={busy || !fresh || now - Date.parse(potato.received_at) < 600} onClick={() => void pass(team.id)} className="shrink-0 rounded-xl bg-violet-600 px-3 py-3 text-sm font-black text-white disabled:opacity-40">{busy ? '…' : 'Pass'}</button>}
        </div>
      })}
    </div>
    {!own && ownTeamId && <p className={`mt-3 text-sm ${muted}`}>This round already started. Spectate now and join the next activity.</p>}
    <p className={`mt-3 text-xs ${muted}`}>{finished ? 'Only banked points count. Any points still pending at the buzzer were lost.' : 'Potatoes get shakier with age. Passing does not reset them. Pending points are lost if any potato explodes—or you still hold one at the buzzer.'}</p>
    {finished && settings && typeof settings === 'object' && !Array.isArray(settings) && settings.hot_potato_tied === true && <p className={`mt-2 text-xs ${muted}`}>Top banked scores tied. A random draw chose the winner.</p>}
    <style>{`@keyframes potato-wobble { from { transform: rotate(-5deg) translateX(-1px); } to { transform: rotate(5deg) translateX(1px); } }`}</style>
  </div>
}
