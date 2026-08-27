"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const REACTIONS = ['👍', '👎', '❤️', '😂', '😢', '😡'] as const

type ReactionEvent = {
  id: string
  reaction: string
  team_name: string
  created_at: string
}

export default function LiveReactions({
  gameId,
  canReact = false,
  dark = false,
}: {
  gameId: string | null
  canReact?: boolean
  dark?: boolean
}) {
  const [events, setEvents] = useState<(ReactionEvent & { localKey: string })[]>([])
  const [sending, setSending] = useState(false)
  const cleanupTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    if (!gameId) return
    const timers = cleanupTimers.current
    const channel = supabase
      .channel(`live-reactions-${gameId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_reactions', filter: `game_id=eq.${gameId}` }, payload => {
        const reaction = payload.new as ReactionEvent
        const localKey = `${reaction.id}-${crypto.randomUUID()}`
        setEvents(current => [...current.slice(-7), { ...reaction, localKey }])
        const timer = setTimeout(() => {
          setEvents(current => current.filter(item => item.localKey !== localKey))
          timers.delete(localKey)
        }, 3600)
        timers.set(localKey, timer)
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
      timers.forEach(timer => clearTimeout(timer))
      timers.clear()
    }
  }, [gameId])

  async function sendReaction(reaction: typeof REACTIONS[number]) {
    const requestId = localStorage.getItem('simple-trivia-join-request-id')
    const requestToken = localStorage.getItem('simple-trivia-join-request-token')
    if (!requestId || !requestToken || sending) return
    setSending(true)
    const { error } = await supabase.rpc('send_game_reaction', {
      p_request_id: requestId,
      p_request_token: requestToken,
      p_reaction: reaction,
    })
    if (error) console.error('Could not send reaction:', error)
    window.setTimeout(() => setSending(false), 450)
  }

  if (!gameId) return null

  return (
    <>
      <div aria-live="polite" className="pointer-events-none fixed bottom-36 right-4 z-[70] flex w-52 flex-col items-end gap-2 sm:right-6">
        {events.map(event => (
          <div key={event.localKey} className="live-reaction-float flex max-w-full items-center gap-2 rounded-full px-3 py-2 shadow-xl" style={{ background: dark ? '#211D39EE' : '#FFFFFFF2', border: `1px solid ${dark ? '#3A345B' : '#E8E5F4'}` }}>
            <span className="text-2xl" aria-hidden="true">{event.reaction}</span>
            <span className="truncate text-xs font-extrabold" style={{ color: dark ? '#F4F1FF' : '#18171F' }}>{event.team_name}</span>
          </div>
        ))}
      </div>

      {canReact && (
        <div aria-label="Send a reaction" className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 gap-1 rounded-2xl border border-[#E8E5F4] bg-white/95 p-1.5 shadow-xl backdrop-blur">
          {REACTIONS.map(reaction => (
            <button key={reaction} type="button" disabled={sending} onClick={() => { void sendReaction(reaction) }} className="h-10 w-11 cursor-pointer rounded-xl text-xl transition hover:-translate-y-0.5 hover:bg-violet-50 active:scale-95 disabled:cursor-wait disabled:opacity-60" aria-label={`React ${reaction}`}>
              {reaction}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
