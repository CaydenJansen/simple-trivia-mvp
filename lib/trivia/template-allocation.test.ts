import { describe, expect, it } from 'vitest'
import { allocateTemplateQuestions, allocateTemplateRoundTopics } from './template-allocation'

describe('template question allocation', () => {
  it('F22 assigns random topics using the whole template supply, not greedy local choices', () => {
    const pool = [{ id: 'a', type: 'ranking', topic: 'A' }, { id: 'b', type: 'single', topic: 'B' }]
    const result = allocateTemplateRoundTopics([{ number: 1, topics: ['A','B'] }, { number: 2, topics: ['A'] }],
      [{ round_number: 1, type: 'any' }, { round_number: 2, type: 'ranking' }], pool,
      (s, c) => s.type === 'any' || s.type === c.type, (c, topic) => c.topic === topic, () => 0.99)
    expect(result?.get(1)).toBe('B')
    expect(result?.get(2)).toBe('A')
  })
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
