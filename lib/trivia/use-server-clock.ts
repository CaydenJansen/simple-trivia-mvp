"use client";

import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase/client'
import { createSynchronizedClock } from './synchronized-clock'

const clock = createSynchronizedClock(() => performance.now())
const listeners = new Set<() => void>()
let ready = false
let lastSampleAt = -Infinity
let pending: Promise<void> | null = null
function notify() { for (const listener of listeners) listener() }
function synchronize() {
  if (pending) return pending
  if (ready && performance.now() - lastSampleAt < 30000) return Promise.resolve()
  pending = (async () => {
    const started = performance.now()
    try {
      const { data, error } = await supabase.rpc('get_server_epoch_ms')
      if (!error && typeof data === 'number') {
        clock.sample(data, started, performance.now())
        lastSampleAt = performance.now()
        ready = true
        notify()
      }
    } catch { /* Keep retrying; never advance on an untrusted device clock. */ }
    finally { pending = null }
  })()
  return pending
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function serverNow() { return clock.now() ?? Date.now() }
export function useServerClock() {
  const synchronized = useSyncExternalStore(subscribe, () => ready, () => false)
  useEffect(() => {
    void synchronize()
    const timer = window.setInterval(() => { void synchronize() }, 5000)
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      ready = false
      notify()
      void synchronize()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => { window.clearInterval(timer); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake) }
  }, [])
  return synchronized
}
