"use client";

import { useEffect, useRef } from 'react'

type TeamWheelProps = {
  teamNames: string[]
  spinning?: boolean
  winnerName?: string | null
  dark?: boolean
}

const WHEEL_COLORS = ['#7C3AED', '#F59E0B', '#10B981', '#EC4899', '#2563EB', '#F97316']

export default function TeamWheel({ teamNames, spinning = false, winnerName = null, dark = false }: TeamWheelProps) {
  const names = teamNames.length > 0 ? teamNames : ['Waiting for teams…']
  const slice = 360 / names.length
  const winnerIndex = winnerName ? names.indexOf(winnerName) : -1
  const restingRotation = winnerIndex >= 0 ? -((winnerIndex * slice) + (slice / 2)) : 0
  const wheelRef = useRef<HTMLDivElement>(null)
  const rotationRef = useRef(0)
  const wasSpinningRef = useRef(false)
  const background = names.map((_, index) => {
    const start = index * slice
    return `${WHEEL_COLORS[index % WHEEL_COLORS.length]} ${start}deg ${start + slice}deg`
  }).join(', ')

  useEffect(() => {
    const wheel = wheelRef.current
    if (!wheel) return

    let frame = 0
    if (spinning) {
      wasSpinningRef.current = true
      wheel.style.transition = 'none'
      let previous = performance.now()
      const animate = (now: number) => {
        rotationRef.current += Math.min(40, now - previous) * 0.62
        previous = now
        wheel.style.transform = `rotate(${rotationRef.current}deg)`
        frame = requestAnimationFrame(animate)
      }
      frame = requestAnimationFrame(animate)
    } else if (winnerIndex >= 0) {
      const current = rotationRef.current
      const currentMod = ((current % 360) + 360) % 360
      const targetMod = ((restingRotation % 360) + 360) % 360
      const target = current + ((targetMod - currentMod + 360) % 360) + (360 * (wasSpinningRef.current ? 3 : 0))
      rotationRef.current = target
      wasSpinningRef.current = false
      wheel.style.transition = 'transform 2800ms cubic-bezier(.12,.72,.12,1)'
      frame = requestAnimationFrame(() => { wheel.style.transform = `rotate(${target}deg)` })
    } else {
      wheel.style.transition = 'none'
      wheel.style.transform = `rotate(${rotationRef.current}deg)`
    }

    return () => cancelAnimationFrame(frame)
  }, [restingRotation, spinning, winnerIndex])

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-72 w-72 sm:h-96 sm:w-96">
        <div className="absolute left-1/2 top-[-10px] z-20 -translate-x-1/2 border-x-[14px] border-t-[24px] border-x-transparent border-t-rose-500 drop-shadow-lg" />
        <div
          ref={wheelRef}
          aria-label={`Prize wheel containing ${names.join(', ')}`}
          className="relative h-full w-full overflow-hidden rounded-full border-[10px] shadow-2xl"
          style={{
            background: `conic-gradient(${background})`,
            borderColor: dark ? '#2F2A48' : '#FFFFFF',
          }}
        >
          {names.map((name, index) => {
            const angle = (index * slice) + (slice / 2)
            return (
              <span
                key={`${name}-${index}`}
                className="absolute left-1/2 top-1/2 w-[42%] origin-left truncate text-[10px] font-black text-white drop-shadow sm:text-xs"
                style={{ transform: `rotate(${angle - 90}deg) translateX(18%)`, textAlign: 'right' }}
              >
                {name}
              </span>
            )
          })}
        </div>
        <div style={{ background: dark ? '#181329' : '#FFFFFF', color: '#7C3AED' }} className="absolute left-1/2 top-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-violet-500 text-2xl shadow-xl">★</div>
      </div>
    </div>
  )
}
