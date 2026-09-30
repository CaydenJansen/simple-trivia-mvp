"use client";

import { useEffect, useRef, useState } from 'react'

type Props = {
  src?: string | null
  alt?: string
  className?: string
  compact?: boolean
}

// A replacement URL must not inherit the previous image's load/error/dialog state.
export default function QuestionImage({ src, ...props }: Props) {
  const url = src?.trim()
  return url ? <ImageView key={url} src={url} {...props} /> : null
}

function ImageView({ src, alt = 'Question image', className = '', compact = false }: Props & { src: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [open, setOpen] = useState(false)
  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 })
  const thumbnail = useRef<HTMLImageElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const imageViewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !imageViewport.current) return
    const viewport = imageViewport.current
    const fitImage = () => {
      const img = thumbnail.current
      if (!img?.naturalWidth || !viewport.clientWidth || !viewport.clientHeight) return
      const fit = Math.min(viewport.clientWidth / img.naturalWidth, viewport.clientHeight / img.naturalHeight)
      setBaseSize({ width: img.naturalWidth * fit, height: img.naturalHeight * fit })
    }
    fitImage()
    const observer = new ResizeObserver(fitImage)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [open])
  // Never proxy arbitrary host URLs through an unrestricted server image loader.
  const safeUrl = /^(https?:\/\/|\/(?!\/))/i.test(src)

  return (
    <div className={`min-w-0 ${className}`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      {status === 'error' || !safeUrl ? (
        <div role="status" className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-center text-sm text-zinc-700">
          <p>Image couldn’t load. Check that the link opens an image without signing in.</p>
          {safeUrl && <button type="button" className="mt-2 rounded-lg px-3 py-2 font-bold text-violet-700 focus-visible:outline-2 focus-visible:outline-violet-600" onClick={() => { setStatus('loading'); setAttempt(value => value + 1) }}>Retry image</button>}
        </div>
      ) : (
        <>
          {status === 'loading' && <p role="status" className="py-3 text-center text-xs opacity-70">Loading image…</p>}
          <button type="button" aria-label={`Enlarge ${alt.toLowerCase()}`} disabled={status !== 'loaded'}
            className="mx-auto block max-w-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500"
            onClick={() => {
              const img = thumbnail.current
              if (img) {
                const fit = Math.min(window.innerWidth * .88 / img.naturalWidth, window.innerHeight * .65 / img.naturalHeight)
                setBaseSize({ width: img.naturalWidth * fit, height: img.naturalHeight * fit })
              }
              setZoom(1)
              dialog.current?.showModal()
              setOpen(true)
            }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Host-authored URLs with unknown intrinsic dimensions. */}
            <img ref={thumbnail} key={attempt} src={src} alt={alt} draggable={false} decoding="async" referrerPolicy="no-referrer"
              onLoad={() => setStatus('loaded')} onError={() => setStatus('error')}
              className="mx-auto block rounded-xl bg-white object-contain"
              style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: compact ? 'min(28svh, 200px)' : 'min(45svh, 480px)', display: status === 'loaded' ? 'block' : 'none' }} />
          </button>
          {status === 'loaded' && <p className="mt-1.5 text-center text-[11px] opacity-70">Tap image to enlarge</p>}
        </>
      )}
      <dialog ref={dialog} aria-label={`${alt} enlarged`} onClose={() => setOpen(false)} className="m-auto h-[94svh] max-h-[94svh] w-[94vw] max-w-[94vw] overflow-hidden rounded-2xl border border-white/20 bg-[#171526] p-3 text-white shadow-2xl backdrop:bg-black/80 open:flex open:flex-col"
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); dialog.current?.close() } }}
        onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}>
        <div className="mb-3 flex shrink-0 items-center justify-between gap-5">
          <p className="text-sm font-bold">{alt}</p>
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-violet-400">Close image</button>
        </div>
        <div className="mb-3 flex shrink-0 items-center justify-center gap-3" aria-label="Image zoom controls">
          <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))} className="h-10 w-10 rounded-lg bg-white/15 text-xl disabled:opacity-40">−</button>
          <button type="button" aria-label="Reset image zoom" onClick={() => setZoom(1)} className="rounded-lg px-3 py-2 text-sm font-bold">{Math.round(zoom * 100)}% · Reset</button>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .5))} className="h-10 w-10 rounded-lg bg-white/15 text-xl disabled:opacity-40">+</button>
        </div>
        <p className="mb-2 shrink-0 text-center text-xs text-white/70">Zoom in, then scroll or swipe to explore.</p>
        <div ref={imageViewport} className="min-h-0 flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
        {status === 'loaded' && (
          /* eslint-disable-next-line @next/next/no-img-element -- Same public image, without cropping or a remote loader. */
          <img src={src} alt={alt} draggable={false} referrerPolicy="no-referrer" className="mx-auto block max-w-none rounded-lg bg-white object-contain" style={{ width: baseSize.width * zoom || 'auto', height: baseSize.height * zoom || 'auto' }} />
        )}
        </div>
      </dialog>
    </div>
  )
}
