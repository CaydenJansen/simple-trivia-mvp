"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// Facebook's familiar left-to-right reaction order: Like, Love, Care, Haha, Wow, Sad, Angry.
const REACTIONS = ['👍', '❤️', '🥰', '😂', '😮', '😢', '😡'] as const

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
  hostPlacement = false,
  inlineHostPlacement = false,
}: {
  gameId: string | null
  canReact?: boolean
  dark?: boolean
  hostPlacement?: boolean
  inlineHostPlacement?: boolean
}) {
  const [events, setEvents] = useState<(ReactionEvent & { localKey: string })[]>([])
  const [sending, setSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const cleanupTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    if (!gameId) return
    const timers = cleanupTimers.current
    const channel = supabase
      .channel(`live-reactions-${gameId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_reactions', filter: `game_id=eq.${gameId}` }, payload => {
        const reaction = payload.new as ReactionEvent
        const localKey = `${reaction.id}-${crypto.randomUUID()}`
        setEvents(current => [...current.slice(-4), { ...reaction, localKey }])
        const timer = setTimeout(() => {
          setEvents(current => current.filter(item => item.localKey !== localKey))
          timers.delete(localKey)
        }, 2200)
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
      {events.length > 0 && (
        <div aria-live="polite" className={inlineHostPlacement
          ? 'pointer-events-none sticky bottom-0 z-20 ml-auto mt-3 flex w-full flex-col items-end gap-2'
          : `pointer-events-none fixed right-3 z-[70] flex w-52 flex-col items-end gap-1.5 sm:right-4 ${hostPlacement ? 'top-20' : 'top-16'}`}>
          {events.map(event => (
            <div key={event.localKey} className="live-reaction-float flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1.5 shadow-lg" style={{ background: dark ? '#211D39EE' : '#FFFFFFF2', border: `1px solid ${dark ? '#3A345B' : '#E8E5F4'}` }}>
              <span className="text-lg" aria-hidden="true">{event.reaction}</span>
              <span className="truncate text-[10px] font-extrabold" style={{ color: dark ? '#F4F1FF' : '#18171F' }}>{event.team_name}</span>
            </div>
          ))}
        </div>
      )}

      {canReact && (
        <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-40 flex flex-col items-start gap-2 sm:left-4">
          {pickerOpen && (
            <div aria-label="Send a reaction" className="flex gap-0.5 rounded-2xl border border-[#E8E5F4] bg-white/95 p-1.5 shadow-xl backdrop-blur">
              {REACTIONS.map(reaction => (
                <button key={reaction} type="button" disabled={sending} onClick={() => { void sendReaction(reaction) }} className="h-10 w-10 cursor-pointer rounded-xl text-xl transition hover:-translate-y-0.5 hover:bg-violet-50 active:scale-95 disabled:cursor-wait disabled:opacity-60" aria-label={`React ${reaction}`}>
                  {reaction}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label={pickerOpen ? 'Close reactions' : 'Open reactions'}
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen(open => !open)}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[#DDD7F1] bg-white/95 text-xl shadow-lg transition hover:-translate-y-0.5 hover:bg-violet-50 active:scale-95"
          >
            {pickerOpen ? '×' : '😊'}
          </button>
        </div>
      )}
    </>
  )
}
