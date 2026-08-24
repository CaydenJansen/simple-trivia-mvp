import { describe, expect, it } from 'vitest'

import { hostKeyboardNavigation } from './host-keyboard-navigation'

describe('host keyboard navigation', () => {
  it('maps Space and Right Arrow to the forward action', () => {
    expect(hostKeyboardNavigation(' ', 'Space')).toBe('forward')
    expect(hostKeyboardNavigation('ArrowRight')).toBe('forward')
  })

  it('maps Left Arrow to the available back action', () => {
    expect(hostKeyboardNavigation('ArrowLeft')).toBe('back')
  })

  it('ignores unrelated keys', () => {
    expect(hostKeyboardNavigation('Enter')).toBeNull()
  })
})
