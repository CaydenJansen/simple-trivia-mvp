import { describe, expect, it } from 'vitest'

import { sourceQuestionPreview } from './source-question-preview'

describe('source question answer previews', () => {
  it('pairs every multi-part prompt with its answer and accepted alternatives', () => {
    const preview = sourceQuestionPreview({
      questionType: 'multi-part',
      correctAnswer: ['Star Trek', 'The Flintstones', 'Futurama'],
      acceptedAnswers: [[], ['Flintstones'], []],
      options: [
        { label: 'A', clue: 'Name the TV show from this alien: Spock' },
        { label: 'B', clue: 'Name the TV show from this alien: The Great Gazoo' },
        { label: 'C', clue: 'Name the TV show from this alien: Zoidberg' },
      ],
    })

    expect(preview.kind).toBe('multi-part')
    expect(preview.rows).toEqual([
      { label: 'A', prompt: 'Name the TV show from this alien: Spock', answer: 'Star Trek', aliases: [], correct: true },
      { label: 'B', prompt: 'Name the TV show from this alien: The Great Gazoo', answer: 'The Flintstones', aliases: ['Flintstones'], correct: true },
      { label: 'C', prompt: 'Name the TV show from this alien: Zoidberg', answer: 'Futurama', aliases: [], correct: true },
    ])
  })

  it('marks the correct multiple-choice option without hiding the other options', () => {
    const preview = sourceQuestionPreview({
      questionType: 'multiple-choice',
      correctAnswer: 'B',
      acceptedAnswers: [],
      options: [
        { key: 'A', label: 'Mercury' },
        { key: 'B', label: 'Venus' },
        { key: 'C', label: 'Mars' },
      ],
    })

    expect(preview.rows.map(row => [row.answer, row.correct])).toEqual([
      ['Mercury', false],
      ['Venus', true],
      ['Mars', false],
    ])
  })
})
