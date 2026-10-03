"use client";

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'

export default function FirstShowGuide({ hasQuiz, firstTime = true, onCreate, onPractice }: { hasQuiz: boolean; firstTime?: boolean; onCreate: () => void; onPractice: () => void }) {
  const [open, setOpen] = useState(firstTime)
  const [storageKey, setStorageKey] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return
      const key = `gtc-first-show-guide:${data.user.id}`
      setStorageKey(key)
      try { const saved = localStorage.getItem(key); setOpen(saved === 'open' || (saved !== 'dismissed' && firstTime)) } catch { /* Guide still works without storage. */ }
    })
    return () => { active = false }
  }, [firstTime])
  function toggle(value: boolean) {
    setOpen(value)
    try { if (storageKey) localStorage.setItem(storageKey, value ? 'open' : 'dismissed') } catch { /* Optional preference. */ }
  }
  if (!open) return <button type="button" onClick={() => toggle(true)} className="mb-5 text-sm font-bold text-violet-700 underline">First-show guide</button>
  return <section aria-label="First-show guide" className="mb-6 rounded-2xl border border-violet-200 bg-violet-50 p-5 text-zinc-900">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-extrabold">Your first show, step by step</h2><p className="mt-1 text-sm text-zinc-600">Build it, rehearse it, then invite your audience.</p></div><button type="button" onClick={() => toggle(false)} className="text-xs font-bold text-violet-700">Hide guide</button></div>
    <ol className="mt-4 grid gap-4 md:grid-cols-3">
      <li><h3 className="font-bold">1. Create and save a quiz</h3><p className="mt-1 text-sm text-zinc-600">Use Auto-Build or write your own. Add games and content screens, then save until it says Ready.</p><button type="button" onClick={onCreate} className="mt-2 font-bold text-violet-700">Create a quiz →</button></li>
      <li><h3 className="font-bold">2. Try a practice run</h3><p className="mt-1 text-sm text-zinc-600">Open a ready quiz’s Host Game settings and select Practice. Simulated teams answer and play while you learn the controls.</p><button type="button" disabled={!hasQuiz} onClick={onPractice} className="mt-2 font-bold text-violet-700 disabled:text-zinc-400">{hasQuiz ? 'Practise a ready quiz →' : 'Save a ready quiz first'}</button></li>
      <li><h3 className="font-bold">3. Host the real show</h3><p className="mt-1 text-sm text-zinc-600">Select Live show, check your prizes and timing, then open the lobby. Share the QR code, approve teams and press Start. Session health helps you spot connection trouble.</p></li>
    </ol>
    <p className="mt-4 text-xs text-zinc-600">During play: close answers → review anything uncertain → reveal → continue. Auto-Run handles timing but still stops for round review.</p>
  </section>
}
