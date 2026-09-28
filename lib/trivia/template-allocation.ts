// Find a distinct candidate for every slot, allowing earlier choices to move
// when a later restricted slot needs them. Output always retains slot order.
export function allocateTemplateQuestions<S, C>(
  slots: S[], candidates: C[], matches: (slot: S, candidate: C) => boolean,
  random: () => number = Math.random,
): C[] | null {
  const edges = slots.map(slot => {
    const eligible = candidates.flatMap((candidate, index) => matches(slot, candidate) ? [index] : [])
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[eligible[i], eligible[j]] = [eligible[j], eligible[i]]
    }
    return eligible
  })
  const owner = new Map<number, number>()
  const assigned = new Map<number, number>()
  function claim(slot: number, visited: Set<number>): boolean {
    for (const candidate of edges[slot]) {
      if (visited.has(candidate)) continue
      visited.add(candidate)
      const previous = owner.get(candidate)
      if (previous === undefined || claim(previous, visited)) {
        owner.set(candidate, slot)
        assigned.set(slot, candidate)
        return true
      }
    }
    return false
  }
  const order = slots.map((_, index) => index).sort((a, b) => edges[a].length - edges[b].length)
  for (const slot of order) if (!claim(slot, new Set())) return null
  return slots.map((_, index) => candidates[assigned.get(index)!])
}

// Topic viability is global: independently viable rounds can compete for the
// same questions. Backtrack topic choices while preserving a full allocation.
export function allocateTemplateRoundTopics<S extends { round_number: number }, C>(
  rounds: { number: number; topics: string[] }[], slots: S[], candidates: C[],
  matchesType: (slot: S, candidate: C) => boolean,
  matchesTopic: (candidate: C, topic: string) => boolean,
  random: () => number = Math.random,
): Map<number, string> | null {
  const choices = rounds.map(round => {
    const roundSlots = slots.filter(slot => slot.round_number === round.number)
    const topics = round.topics.filter(topic => allocateTemplateQuestions(roundSlots, candidates,
      (slot, candidate) => matchesType(slot, candidate) && matchesTopic(candidate, topic), random) !== null)
    for (let i = topics.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[topics[i], topics[j]] = [topics[j], topics[i]]
    }
    return { number: round.number, topics }
  }).sort((a, b) => a.topics.length - b.topics.length)
  const selected = new Map<number, string>()
  function choose(index: number): boolean {
    if (index === choices.length) return true
    const round = choices[index]
    const usedTopics = new Set(selected.values())
    const preferred = [...round.topics].sort((a, b) => Number(usedTopics.has(a)) - Number(usedTopics.has(b)))
    for (const topic of preferred) {
      selected.set(round.number, topic)
      const feasible = allocateTemplateQuestions(slots, candidates, (slot, candidate) => matchesType(slot, candidate)
        && (!selected.has(slot.round_number) || matchesTopic(candidate, selected.get(slot.round_number)!)), random)
      if (feasible && choose(index + 1)) return true
      selected.delete(round.number)
    }
    return false
  }
  return choose(0) ? selected : null
}
