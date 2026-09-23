"use client";

import { useCallback, useEffect, useState } from "react";

import BrandWordmark from "@/components/BrandWordmark";
import { supabase } from "@/lib/supabase/client";
import { buildGameJoinUrl } from "@/lib/trivia/join-code";
import { hostJoinSlugFromSearch } from "@/lib/trivia/permanent-host-link";

type JoinState = 'checking' | 'waiting' | 'error'

export default function PermanentHostJoin() {
  const slug = typeof window === 'undefined' ? null : hostJoinSlugFromSearch(window.location.search)
  const [state, setState] = useState<JoinState>('checking')
  const [message, setMessage] = useState('Finding today’s game…')
  const [retryKey, setRetryKey] = useState(0)

  const retry = useCallback(() => {
    setState('checking')
    setMessage('Checking again…')
    setRetryKey(value => value + 1)
  }, [])

  useEffect(() => {
    if (!slug) {
      const invalidTimer = setTimeout(() => {
        setState('error')
        setMessage('This permanent join link is not valid.')
      }, 0)
      return () => clearTimeout(invalidTimer)
    }

    const resolvedSlug = slug
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    async function resolveGame() {
      const { data, error } = await supabase.rpc('resolve_host_join_link', { p_slug: resolvedSlug })
      if (!active) return
      if (error) {
        console.error('Could not resolve permanent host link:', error)
        setState('error')
        setMessage('We couldn’t check for a live game. Check your connection and try again.')
        return
      }

      const activeGame = data?.[0]
      if (activeGame?.game_code) {
        window.location.replace(buildGameJoinUrl(window.location.origin, activeGame.game_code))
        return
      }

      setState('waiting')
      setMessage('There isn’t a game live here right now.')
      retryTimer = setTimeout(() => { if (active) void resolveGame() }, 10000)
    }

    void resolveGame()
    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [retryKey, slug])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F6FF] px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border border-[#E4E1EF] bg-white p-7 text-center shadow-sm sm:p-9">
        <BrandWordmark className="mx-auto mb-7 text-xl" />
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F0E9FF] text-2xl" aria-hidden="true">{state === 'waiting' ? '☕' : state === 'error' ? '↻' : '✨'}</div>
        <h1 className="mt-5 text-2xl font-extrabold text-zinc-900">{state === 'waiting' ? 'No game yet' : state === 'error' ? 'Couldn’t find the game' : 'Joining the game'}</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">{message}</p>
        {state === 'waiting' && <p className="mt-2 text-xs text-zinc-400">You can leave this screen open—we’ll keep checking.</p>}
        {state !== 'checking' && (
          <button type="button" onClick={retry} className="mt-6 w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-violet-700">Check again</button>
        )}
      </section>
    </main>
  )
}
