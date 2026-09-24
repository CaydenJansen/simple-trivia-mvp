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
