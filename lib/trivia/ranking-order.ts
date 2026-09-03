function seedNumber(seed: string) {
  let hash = 2166136261
  for (const character of seed) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: string) {
  let value = seedNumber(seed)
  return () => {
    value += 0x6D2B79F5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function sameOrder(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function initialRankingOrder(
  options: readonly string[],
  correctOrder: readonly string[],
  seed: string,
) {
  const shuffled = [...options]
  const random = seededRandom(seed)
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }

  const forbiddenOrder = correctOrder.length === shuffled.length ? correctOrder : options
  if (shuffled.length > 1 && sameOrder(shuffled, forbiddenOrder)) {
    const firstDifferentIndex = shuffled.findIndex((item, index) => index > 0 && item !== shuffled[0])
    if (firstDifferentIndex > 0) {
      ;[shuffled[0], shuffled[firstDifferentIndex]] = [shuffled[firstDifferentIndex], shuffled[0]]
    }
  }
  return shuffled
}
