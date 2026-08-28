'use client'

export type BigBalloonEntry = {
  team_id: string
  size_units: number
  status: 'ready' | 'inflating' | 'locked' | 'popped'
}

type Team = { id: string; name: string }

const MAX_VISIBLE_UNITS = 10_000_000
const BALLOON_KEYFRAMES = `@keyframes balloon-shake{0%,100%{transform:translate(0) rotate(0)}25%{transform:translate(-2px,1px) rotate(-1deg)}75%{transform:translate(2px,-1px) rotate(1deg)}}@keyframes balloon-shake-hard{0%,100%{transform:translate(0) rotate(0)}20%{transform:translate(-5px,2px) rotate(-3deg)}40%{transform:translate(4px,-3px) rotate(3deg)}60%{transform:translate(-4px,-2px) rotate(-2deg)}80%{transform:translate(5px,3px) rotate(2deg)}}.balloon-shake{animation:balloon-shake .18s infinite}.balloon-shake-hard{animation:balloon-shake-hard .09s infinite}`

export function balloonProgress(sizeUnits: number) {
  return Math.max(0, Math.min(1, sizeUnits / MAX_VISIBLE_UNITS))
}

function balloonPixelSize(entry: BigBalloonEntry, hero = false) {
  return (hero ? 112 : 42) + balloonProgress(entry.size_units) * (hero ? 152 : 54)
}

export function balloonComparisonSizes(own: BigBalloonEntry, winner: BigBalloonEntry) {
  const ownSize = Math.min(180, balloonPixelSize(own, true) * 0.72)
  return { own: ownSize, winner: Math.min(198, Math.max(balloonPixelSize(winner, true) * 0.72, ownSize * 1.05)) }
}

function BalloonGraphic({ entry, dark = false, hero = false, sizeOverride }: { entry: BigBalloonEntry; dark?: boolean; hero?: boolean; sizeOverride?: number }) {
  const progress = balloonProgress(entry.size_units)
  const popped = entry.status === 'popped'
  const size = sizeOverride ?? balloonPixelSize(entry, hero)
  const shake = progress >= 0.78 ? 'balloon-shake-hard' : progress >= 0.5 ? 'balloon-shake' : undefined
  if (popped) return <div aria-label="Popped balloon" className={hero ? 'text-8xl' : 'text-4xl'}>💥</div>
  return (
    <div className={shake} style={{ width: size, height: size * 1.14, transition: 'width 90ms linear, height 90ms linear' }}>
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
      <div className="mt-6 flex w-full max-w-md flex-col items-center">
        <style>{BALLOON_KEYFRAMES}</style>
        {showLosingComparison && winner ? <div className="flex h-[280px] w-full items-end justify-center gap-7 pb-5">
          <div className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-52 items-end justify-center"><BalloonGraphic entry={own} dark={dark} hero sizeOverride={comparisonSizes?.own} /></div>
            <p style={{ color: sub }} className="mt-3 text-xs font-black uppercase tracking-wider">Your balloon</p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex h-52 items-end justify-center"><BalloonGraphic entry={winner} dark={dark} hero sizeOverride={comparisonSizes?.winner} /></div>
            <p style={{ color: '#059669' }} className="mt-3 text-xs font-black uppercase tracking-wider">Winning balloon</p>
          </div>
        </div> : <div className="flex h-[310px] w-full items-end justify-center pb-5"><BalloonGraphic entry={own} dark={dark} hero /></div>}
        {ownStatus === 'popped' ? <><h2 style={{ color: '#ef4444' }} className="text-3xl font-black">POP!</h2><p style={{ color: sub }} className="mt-2 font-semibold">Your balloon got too big. Watch the others finish.</p></>
          : ownStatus === 'locked' ? <><h2 style={{ color: text }} className="text-2xl font-black">Balloon locked in</h2><p style={{ color: sub }} className="mt-2 font-semibold">Hands off—now see if it’s big enough.</p></>
          : <button
            type="button"
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); onHoldStart?.() }}
            onPointerUp={onHoldEnd}
            onPointerCancel={onHoldEnd}
            onContextMenu={event => event.preventDefault()}
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
          <p style={{ color: entry.status === 'popped' ? '#ef4444' : sub }} className="mt-1 text-[10px] font-black uppercase tracking-wider">{entry.status === 'ready' ? 'Waiting' : entry.status}</p>
        </div>
      })}
    </div>
  )
}
