"use client";

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { parseSessionHealth, teamConnectionState, type SessionHealth } from '@/lib/trivia/session-health'

export default function HostSessionTools({ gameId, onExit }: { gameId: string; onExit: () => void }) {
  const [health, setHealth] = useState<SessionHealth | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const [botError, setBotError] = useState('')
  const [lastCheck, setLastCheck] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const checking = useRef(false)
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    if (checking.current) return
    checking.current = true
    try {
      const { data, error } = await supabase.rpc('get_host_session_health', { p_game_id: gameId }).abortSignal(AbortSignal.timeout(8000))
      const parsed = parseSessionHealth(data)
      if (error || !parsed) throw new Error('Health check unavailable')
      if (mounted.current) { setHealth(parsed); setLastCheck(Date.now()); setError('') }
    } catch { if (mounted.current) setError('Connection check failed. The saved game is safe; check your internet and try again.') }
    finally { checking.current = false }
  }, [gameId])
  useEffect(() => {
    mounted.current = true
    const initial = window.setTimeout(() => void refresh(), 0)
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 5000)
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    const wake = () => { if (document.visibilityState === 'visible') void refresh() }
    const offline = () => setError('You’re offline. Reconnect to sync with the show.')
    window.addEventListener('online', wake); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', wake)
    return () => { mounted.current = false; clearTimeout(initial); clearInterval(poll); clearInterval(clock); window.removeEventListener('online', wake); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', wake) }
  }, [refresh])

  useEffect(() => {
    if (!health?.practice || health.paused || !['lobby', 'live'].includes(health.status)) return
    let active = true, inFlight = false
    const tick = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const { data, error } = await supabase.rpc('tick_practice_game', { p_game_id: gameId }).abortSignal(AbortSignal.timeout(8000))
        if (active) setBotError(error ? 'Simulated teams could not sync. They will retry automatically.' : data && typeof data === 'object' && !Array.isArray(data) && Number(data.failures) > 0 ? 'Some simulated moves were rejected by the game rules; teams will try again.' : '')
      } catch { if (active) setBotError('Simulated teams could not sync. They will retry automatically.') }
      finally { inFlight = false }
    }
    const timer = window.setInterval(() => void tick(), 750)
    void tick()
    return () => { active = false; clearInterval(timer) }
  }, [gameId, health?.practice, health?.paused, health?.status])

  async function control(action: 'pause' | 'resume' | 'stop') {
    if (busy || (action === 'stop' && !window.confirm('End this practice? Your saved quiz will not change.'))) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('control_practice_game', { p_game_id: gameId, p_action: action })
      if (error) throw error
      if (action === 'stop') { onExit(); return }
      await refresh()
    } catch { setError('Could not change the practice session. Please try again.') }
    finally { setBusy(false) }
  }
  const stale = lastCheck !== null && now - lastCheck > 15_000
  const serverNow = health && lastCheck ? Date.parse(health.server_time) + (now - lastCheck) : now
  const concerns = health?.teams.filter(team => teamConnectionState(team.last_seen_at, serverNow) !== 'recent') ?? []
  const button = 'rounded-lg border border-white/20 px-3 py-2 text-xs font-bold hover:bg-white/10 disabled:opacity-50'
  return <aside aria-label="Session health and practice controls" className="fixed bottom-3 left-3 z-40 max-w-[calc(100vw-24px)] rounded-2xl border border-violet-400/30 bg-[#181329] text-white shadow-xl">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-bold">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${error || stale ? 'bg-red-400' : concerns.length ? 'bg-amber-400' : health ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
      {health?.practice ? 'Practice · ' : ''}{error || stale ? 'Check connection' : health ? `Session health${concerns.length ? ` · ${concerns.length} to check` : ''}` : 'Checking connection…'}<span aria-hidden="true">{expanded ? '⌄' : '⌃'}</span>
    </button>
    {expanded && <div className="max-h-[65vh] w-80 max-w-full space-y-3 overflow-auto border-t border-white/10 p-4 text-sm">
      {health?.practice && <div className="space-y-2 rounded-xl bg-violet-500/20 p-3">
        <p className="font-bold">Practice — simulated teams</p>
        <p className="text-xs leading-5 text-violet-100">Your quiz stays unchanged. This session does not affect real-game statistics or your venue QR. Keep this host tab open for bots to play; a sleeping computer pauses them.</p>
        <a href={`/play?code=${encodeURIComponent(health.code)}`} target="_blank" rel="noopener noreferrer" className="block font-bold text-violet-200 underline">Join on the real player screen ↗</a>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void control(health.paused ? 'resume' : 'pause')}>{health.paused ? 'Resume teams' : 'Pause teams'}</button><button type="button" className={button} disabled={busy} onClick={() => void control('stop')}>End practice</button></div>
        <p className="text-xs text-violet-200">Pausing teams does not pause the game timer.</p>
        {botError && <p role="status" className="text-xs text-amber-200">{botError}</p>}
      </div>}
      <p className="text-xs text-violet-100">{lastCheck ? `Last successful check ${Math.max(0, Math.floor((now - lastCheck) / 1000))}s ago.` : 'Waiting for a successful server check.'}</p>
      {(error || stale) && <p role="alert" className="text-xs text-red-200">{error || 'Updates are delayed. Retry the connection check.'}</p>}
      <button type="button" className={button} onClick={() => void refresh()}>Check again</button>
      <button type="button" className={`${button} ml-2`} onClick={() => window.location.reload()}>Reload saved show</button>
      <p className="text-xs leading-5 text-violet-200">Presence is checked about every 45 seconds. “Delayed” may mean a sleeping phone. Ask the team to reopen the page; their saved answers remain safe.</p>
      {health?.teams.length === 0 && <p className="text-xs">No teams have joined yet.</p>}
      <ul className="space-y-2">{health?.teams.map(team => {
        const status = teamConnectionState(team.last_seen_at, serverNow)
        return <li key={team.id} className="rounded-lg bg-white/5 p-2"><p className="break-words font-bold">{team.name}{team.simulated ? ' · simulated' : ''}</p><p className={`text-xs ${status === 'recent' ? 'text-emerald-300' : 'text-amber-200'}`}>{status === 'recent' ? 'Recently seen' : status === 'delayed' ? 'Connection delayed' : 'Asleep / not recently seen'}</p>{team.submitted !== null && <p className="text-xs text-violet-200">{team.submitted ? 'Answer received by server' : 'No saved submission for this answer yet'}</p>}</li>
      })}</ul>
      <p className="text-xs text-violet-200">This checks saved submissions, not unsent text on a phone.</p>
    </div>}
  </aside>
}
