export type HostKeyboardNavigation = 'forward' | 'back'

export function hostKeyboardNavigation(key: string, code = ''): HostKeyboardNavigation | null {
  if (key === 'ArrowRight' || key === ' ' || code === 'Space') return 'forward'
  if (key === 'ArrowLeft') return 'back'
  return null
}
