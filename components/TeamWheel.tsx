"use client";

import { useEffect, useRef, useState } from 'react'

type TeamWheelProps = {
  teamNames: string[]
  spinning?: boolean
  winnerName?: string | null
  landingKey?: string | null
  dark?: boolean
  compact?: boolean
  onSettled?: () => void
}

const WHEEL_COLORS = ['#7C3AED', '#F59E0B', '#10B981', '#EC4899', '#2563EB', '#F97316']

export function wheelLandingFraction(key: string) {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  // Keep the pointer just inside a slice so tiny cross-browser rounding
  // differences can never make two devices display different winners.
  return 0.04 + ((hash >>> 0) / 4294967295) * 0.92
}

export default function TeamWheel({ teamNames, spinning = false, winnerName = null, landingKey = null, dark = false, compact = false, onSettled }: TeamWheelProps) {
  // Every device derives the same slice order, independent of Realtime row order.
  const names = teamNames.length > 0
    ? [...teamNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    : ['Waiting for teams…']
  const namesKey = names.join('\u0000')
  const slice = 360 / names.length
  const winnerIndex = winnerName ? names.indexOf(winnerName) : -1
  const landingFraction = wheelLandingFraction(landingKey || winnerName || namesKey)
  const restingRotation = winnerIndex >= 0 ? -((winnerIndex * slice) + (slice * landingFraction)) : 0
  const wheelRef = useRef<HTMLDivElement>(null)
  const rotationRef = useRef(0)
  const wasSpinningRef = useRef(false)
  const [selectedName, setSelectedName] = useState(names[0])
  const background = names.map((_, index) => {
    const start = index * slice
    return `${WHEEL_COLORS[index % WHEEL_COLORS.length]} ${start}deg ${start + slice}deg`
  }).join(', ')

  useEffect(() => {
    const wheel = wheelRef.current
    if (!wheel) return
    const animatedNames = namesKey.split('\u0000')

    let frame = 0
    let cancelled = false
    const updateWheel = (rotation: number) => {
      rotationRef.current = rotation
      wheel.style.transform = `rotate(${rotation}deg)`
      const pointerAngle = ((-rotation % 360) + 360) % 360
      const selectedIndex = Math.min(animatedNames.length - 1, Math.floor(pointerAngle / slice))
      setSelectedName(current => current === animatedNames[selectedIndex] ? current : animatedNames[selectedIndex])
    }

    if (spinning) {
      wasSpinningRef.current = true
      wheel.style.transition = 'none'
      let previous: number | null = null
      const cruisingSpeed = 1.45
      const animate = (now: number) => {
        const elapsed = previous === null ? 16 : Math.min(40, now - previous)
        const nextRotation = rotationRef.current + (elapsed * cruisingSpeed)
        previous = now
        updateWheel(nextRotation)
        frame = requestAnimationFrame(animate)
      }
      frame = requestAnimationFrame(animate)
    } else if (winnerIndex >= 0) {
      const current = rotationRef.current
      const currentMod = ((current % 360) + 360) % 360
      const targetMod = ((restingRotation % 360) + 360) % 360
      const shouldSettle = wasSpinningRef.current
      const duration = 8000
      const cruisingSpeed = 1.45
      // A cubic ease starts at 3 * distance / duration. Choose the number of
      // turns so settling begins at the existing cruise speed, then only slows.
      const idealDistance = cruisingSpeed * duration / 3
      const targetOffset = (targetMod - currentMod + 360) % 360
      const fullTurns = shouldSettle ? Math.max(2, Math.floor((idealDistance - targetOffset) / 360)) : 0
      const target = current + targetOffset + (360 * fullTurns)
      wasSpinningRef.current = false
      wheel.style.transition = 'none'
      if (!shouldSettle) {
        updateWheel(target)
        setSelectedName(animatedNames[winnerIndex])
        onSettled?.()
      } else {
        let started: number | null = null
        const settle = (now: number) => {
          if (started === null) started = now
          const progress = Math.min(1, (now - started) / duration)
          const eased = 1 - ((1 - progress) ** 3)
          updateWheel(current + ((target - current) * eased))
          if (progress < 1) frame = requestAnimationFrame(settle)
          else {
            setSelectedName(animatedNames[winnerIndex])
            if (!cancelled) onSettled?.()
          }
        }
        frame = requestAnimationFrame(settle)
      }
    } else {
      wheel.style.transition = 'none'
      updateWheel(rotationRef.current)
    }

    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [namesKey, onSettled, restingRotation, slice, spinning, winnerIndex])

  return (
    <div className="flex flex-col items-center">
      <div style={{ background: dark ? '#211A38' : '#F3EEFF', color: dark ? '#F4F1FF' : '#4C1D95' }} className={`${compact ? 'mb-3 min-h-11 max-w-xs px-4 py-2' : 'mb-5 min-h-14 max-w-sm px-5 py-3'} w-full rounded-2xl text-center shadow-sm`}>
        <p style={{ color: dark ? '#A9A4BF' : '#77738C' }} className="text-[10px] font-black uppercase tracking-[0.18em]">Under the pointer</p>
        <p className={`${compact ? 'text-base' : 'mt-1 text-xl'} truncate font-black`}>{selectedName}</p>
      </div>
      <div className={`relative ${compact ? 'h-44 w-44 sm:h-52 sm:w-52' : 'h-56 w-56 sm:h-64 sm:w-64'}`}>
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
        <div style={{ background: dark ? '#181329' : '#FFFFFF', color: '#7C3AED' }} className={`absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-violet-500 shadow-xl ${compact ? 'h-12 w-12 text-lg' : 'h-16 w-16 text-2xl'}`}>★</div>
      </div>
    </div>
  )
}
