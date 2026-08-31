'use client'

import type { CSSProperties } from 'react'

export type BigBalloonEntry = {
  team_id: string
  size_units: number
  status: 'ready' | 'inflating' | 'locked' | 'popped'
}

type Team = { id: string; name: string }

const MAX_VISIBLE_UNITS = 10_000_000
const BALLOON_KEYFRAMES = `@keyframes balloon-shake-progressive{0%,100%{transform:translate(0,0) rotate(0)}20%{transform:translate(calc(var(--balloon-shake-x) * -1),calc(var(--balloon-shake-y) * .55)) rotate(calc(var(--balloon-shake-r) * -1))}40%{transform:translate(var(--balloon-shake-x),calc(var(--balloon-shake-y) * -.7)) rotate(var(--balloon-shake-r))}60%{transform:translate(calc(var(--balloon-shake-x) * -.75),calc(var(--balloon-shake-y) * -.5)) rotate(calc(var(--balloon-shake-r) * -.8))}80%{transform:translate(calc(var(--balloon-shake-x) * .9),var(--balloon-shake-y)) rotate(calc(var(--balloon-shake-r) * .85))}}.balloon-shake-progressive{animation:balloon-shake-progressive var(--balloon-shake-duration) linear infinite}`

export function balloonProgress(sizeUnits: number) {
  return Math.max(0, Math.min(1, sizeUnits / MAX_VISIBLE_UNITS))
}

function balloonPixelSize(entry: BigBalloonEntry, hero = false) {
  return (hero ? 96 : 38) + balloonProgress(entry.size_units) * (hero ? 126 : 48)
}

export function balloonComparisonSizes(own: BigBalloonEntry, winner: BigBalloonEntry) {
  const ownSize = Math.min(180, balloonPixelSize(own, true) * 0.72)
  return { own: ownSize, winner: Math.min(198, Math.max(balloonPixelSize(winner, true) * 0.72, ownSize * 1.05)) }
}

export function balloonShakeStyle(progress: number): CSSProperties | undefined {
  if (progress < 0.5) return undefined
  const pressure = Math.max(0, Math.min(1, (progress - 0.5) / 0.5))
  const intensity = Math.pow(pressure, 1.55)
  return {
    '--balloon-shake-x': `${(0.25 + intensity * 8.15).toFixed(2)}px`,
    '--balloon-shake-y': `${(0.2 + intensity * 6.7).toFixed(2)}px`,
    '--balloon-shake-r': `${(0.2 + intensity * 5.8).toFixed(2)}deg`,
    '--balloon-shake-duration': `${(0.48 - intensity * 0.36).toFixed(3)}s`,
  } as CSSProperties
}

function BalloonGraphic({ entry, dark = false, hero = false, sizeOverride }: { entry: BigBalloonEntry; dark?: boolean; hero?: boolean; sizeOverride?: number }) {
  const progress = balloonProgress(entry.size_units)
  const popped = entry.status === 'popped'
  const size = sizeOverride ?? balloonPixelSize(entry, hero)
  const shakeStyle = balloonShakeStyle(progress)
  if (popped) return <div aria-label="Popped balloon" className={hero ? 'text-8xl' : 'text-4xl'}>💥</div>
  return (
    <div className={shakeStyle ? 'balloon-shake-progressive' : undefined} style={{ ...shakeStyle, width: size, height: size * 1.14, transition: 'width 90ms linear, height 90ms linear' }}>
      <div
        aria-label="Inflating balloon"
        className="relative h-full w-full rounded-[50%_50%_46%_46%]"
        style={{
          background: 'radial-gradient(circle at 34% 25%, #fbcfe8 0 8%, #ec4899 38%, #be185d 100%)',
          boxShadow: dark ? '0 18px 45px rgba(236,72,153,.25)' : '0 18px 45px rgba(190,24,93,.18)',
        }}
      >
        <span className="absolute bottom-[-10px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[8px] border-b-[12px] border-x-transparent border-b-pink-700" />
      </div>
    </div>
  )
}

export default function BigBalloon({
  teams,
  balloons,
  ownTeamId,
  dark = false,
  canInflate = false,
  holding = false,
  onHoldStart,
  onHoldEnd,
  winnerTeamId,
}: {
  teams: Team[]
  balloons: BigBalloonEntry[]
  ownTeamId?: string | null
  dark?: boolean
  canInflate?: boolean
  holding?: boolean
  onHoldStart?: () => void
  onHoldEnd?: () => void
  winnerTeamId?: string | null
}) {
  const own = balloons.find(item => item.team_id === ownTeamId)
  const winner = balloons.find(item => item.team_id === winnerTeamId)
  const showLosingComparison = Boolean(own && winner && ownTeamId !== winnerTeamId)
  const comparisonSizes = own && winner ? balloonComparisonSizes(own, winner) : null
  const ownStatus = own?.status ?? 'ready'
  const panel = dark ? '#171329' : '#fff'
  const line = dark ? '#332b50' : '#e6e1f0'
  const text = dark ? '#f5f3ff' : '#181520'
  const sub = dark ? '#9d95b8' : '#6f6880'

  if (ownTeamId && own) {
    return (
      <div className="mt-6 flex w-full max-w-md select-none flex-col items-center" style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
        <style>{BALLOON_KEYFRAMES}</style>
        {showLosingComparison && winner ? <div className="flex h-[240px] w-full items-end justify-center gap-7 pb-4">
          <div className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-44 items-end justify-center"><BalloonGraphic entry={own} dark={dark} hero sizeOverride={comparisonSizes?.own} /></div>
            <p style={{ color: sub }} className="mt-3 text-xs font-black uppercase tracking-wider">Your balloon</p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-44 items-end justify-center"><BalloonGraphic entry={winner} dark={dark} hero sizeOverride={comparisonSizes?.winner} /></div>
            <p style={{ color: '#059669' }} className="mt-3 text-xs font-black uppercase tracking-wider">Winning balloon</p>
          </div>
        </div> : <div className="flex h-[250px] w-full items-end justify-center pb-4"><BalloonGraphic entry={own} dark={dark} hero /></div>}
        {ownStatus === 'popped' ? <><h2 style={{ color: '#ef4444' }} className="text-3xl font-black">POP!</h2><p style={{ color: sub }} className="mt-2 font-semibold">Your balloon got too big. Watch the others finish.</p></>
          : ownStatus === 'locked' ? <><h2 style={{ color: text }} className="text-2xl font-black">Balloon locked in</h2><p style={{ color: sub }} className="mt-2 font-semibold">Hands off—now see if it’s big enough.</p></>
          : <button
            type="button"
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onHoldStart?.() }}
            onPointerUp={onHoldEnd}
            onPointerCancel={onHoldEnd}
            onContextMenu={event => event.preventDefault()}
            onDragStart={event => event.preventDefault()}
            disabled={!canInflate}
            style={{ background: holding ? '#be185d' : '#7c3aed', touchAction: 'none', userSelect: 'none' }}
            className="w-full rounded-3xl px-6 py-6 text-xl font-black text-white shadow-xl transition-transform active:scale-[.98] disabled:opacity-40"
          >{holding ? 'KEEP HOLDING…' : 'PRESS & HOLD TO INFLATE'}</button>}
      </div>
    )
  }

  return (
    <div className="mx-auto mt-6 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <style>{BALLOON_KEYFRAMES}</style>
      {teams.map(team => {
        const entry = balloons.find(item => item.team_id === team.id)
        if (!entry) return null
        return <div key={team.id} style={{ background: panel, border: `1px solid ${line}`, opacity: entry.status === 'popped' ? 0.55 : 1 }} className="flex min-h-40 flex-col items-center justify-end rounded-2xl p-3">
          <div className="flex h-24 items-end justify-center"><BalloonGraphic entry={entry} dark={dark} /></div>
          <p style={{ color: text }} className="mt-3 w-full truncate text-center text-sm font-black">{team.name}</p>
          <p style={{ color: entry.status === 'popped' ? '#ef4444' : '#c4b5fd' }} className="mt-1 text-sm font-black tabular-nums">{(balloonProgress(entry.size_units) * 100).toFixed(1)}%</p>
          <p style={{ color: entry.status === 'popped' ? '#ef4444' : sub }} className="mt-1 text-[10px] font-black uppercase tracking-wider">{entry.status === 'ready' ? 'Waiting' : entry.status}</p>
        </div>
      })}
    </div>
  )
}
