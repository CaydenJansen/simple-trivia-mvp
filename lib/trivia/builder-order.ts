export type DropPlacement = 'before' | 'after'

export function reorderKeys(
  keys: readonly string[],
  draggedKey: string,
  targetKey: string,
  placement: DropPlacement,
) {
  const fromIndex = keys.indexOf(draggedKey)
  const targetIndex = keys.indexOf(targetKey)

  if (fromIndex < 0 || targetIndex < 0 || draggedKey === targetKey) return [...keys]

  const reordered = [...keys]
  const [dragged] = reordered.splice(fromIndex, 1)
  let insertionIndex = targetIndex + (placement === 'after' ? 1 : 0)

  if (fromIndex < insertionIndex) insertionIndex -= 1
  reordered.splice(insertionIndex, 0, dragged)
  return reordered
}
