import { describe, expect, it } from 'vitest'
import { allocateTemplateQuestions } from './template-allocation'

describe('template question allocation', () => {
  const pool = [{ id: 'r', type: 'ranking' }, { id: 's', type: 'single-answer' }]
  const matches = (slot: string, candidate: typeof pool[number]) => slot === 'any' || slot === candidate.type
  it('reserves restricted questions without changing output order', () => {
    for (const random of [() => 0, () => 0.999]) {
      expect(allocateTemplateQuestions(['any', 'ranking'], pool, matches, random)?.map(q => q.id)).toEqual(['s', 'r'])
      expect(allocateTemplateQuestions(['ranking', 'any'], pool, matches, random)?.map(q => q.id)).toEqual(['r', 's'])
    }
  })
  it('reassigns overlapping topic choices when necessary', () => {
    const result = allocateTemplateQuestions([[0, 1], [0, 2], [0, 2]], [0, 1, 2], (slot, candidate) => slot.includes(candidate), () => 0.999)
    expect(result?.[0]).toBe(1)
    expect(new Set(result).size).toBe(3)
  })
  it('only reports exhaustion when no full assignment exists', () => {
    expect(allocateTemplateQuestions(['ranking', 'ranking'], pool, matches)).toBeNull()
    expect(allocateTemplateQuestions([], pool, matches)).toEqual([])
  })
})
