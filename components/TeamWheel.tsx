"use client";

import { useEffect, useRef, useState } from 'react'

type TeamWheelProps = {
  teamNames: string[]
  spinning?: boolean
  winnerName?: string | null
  dark?: boolean
  onSettled?: () => void
}

const WHEEL_COLORS = ['#7C3AED', '#F59E0B', '#10B981', '#EC4899', '#2563EB', '#F97316']

export default function TeamWheel({ teamNames, spinning = false, winnerName = null, dark = false, onSettled }: TeamWheelProps) {
  const names = teamNames.length > 0 ? teamNames : ['Waiting for teams…']
  const namesKey = names.join('\u0000')
  const slice = 360 / names.length
  const winnerIndex = winnerName ? names.indexOf(winnerName) : -1
  const restingRotation = winnerIndex >= 0 ? -((winnerIndex * slice) + (slice / 2)) : 0
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
      let previous = performance.now()
      const animate = (now: number) => {
        const nextRotation = rotationRef.current + (Math.min(40, now - previous) * 0.62)
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
      const target = current + ((targetMod - currentMod + 360) % 360) + (360 * (shouldSettle ? 5 : 0))
      wasSpinningRef.current = false
      wheel.style.transition = 'none'
      if (!shouldSettle) {
        updateWheel(target)
        setSelectedName(animatedNames[winnerIndex])
        onSettled?.()
      } else {
        const duration = 5600
        const started = performance.now()
        const settle = (now: number) => {
          const progress = Math.min(1, (now - started) / duration)
          const eased = 1 - ((1 - progress) ** 5)
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
      <div style={{ background: dark ? '#211A38' : '#F3EEFF', color: dark ? '#F4F1FF' : '#4C1D95' }} className="mb-5 min-h-14 w-full max-w-sm rounded-2xl px-5 py-3 text-center shadow-sm">
        <p style={{ color: dark ? '#A9A4BF' : '#77738C' }} className="text-[10px] font-black uppercase tracking-[0.18em]">Under the pointer</p>
        <p className="mt-1 truncate text-xl font-black">{selectedName}</p>
      </div>
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
