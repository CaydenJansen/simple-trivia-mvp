"use client";

import { useRef, useState } from 'react'

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
  const dialog = useRef<HTMLDialogElement>(null)
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
            onClick={() => dialog.current?.showModal()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Host-authored URLs with unknown intrinsic dimensions. */}
            <img key={attempt} src={src} alt={alt} draggable={false} decoding="async" referrerPolicy="no-referrer"
              onLoad={() => setStatus('loaded')} onError={() => setStatus('error')}
              className="mx-auto block rounded-xl bg-white object-contain"
              style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: compact ? 'min(28svh, 200px)' : 'min(45svh, 480px)', display: status === 'loaded' ? 'block' : 'none' }} />
          </button>
          {status === 'loaded' && <p className="mt-1.5 text-center text-[11px] opacity-70">Tap image to enlarge</p>}
        </>
      )}
      <dialog ref={dialog} aria-label={`${alt} enlarged`} className="m-auto max-h-[94svh] w-fit max-w-[94vw] overflow-auto rounded-2xl border border-white/20 bg-[#171526] p-3 text-white shadow-2xl backdrop:bg-black/80"
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); dialog.current?.close() } }}
        onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}>
        <div className="mb-3 flex items-center justify-between gap-5">
          <p className="text-sm font-bold">{alt}</p>
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-violet-400">Close image</button>
        </div>
        {status === 'loaded' && (
          /* eslint-disable-next-line @next/next/no-img-element -- Same public image, without cropping or a remote loader. */
          <img src={src} alt={alt} draggable={false} referrerPolicy="no-referrer" className="mx-auto block h-auto w-auto max-w-full rounded-lg bg-white object-contain" style={{ maxHeight: '78svh' }} />
        )}
      </dialog>
    </div>
  )
}
