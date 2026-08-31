export type DropPlacement = 'before' | 'after'

export function nextBuilderItemPosition(itemPositions: readonly number[]) {
  return Math.max(0, ...itemPositions) + 1
}

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

export function moveKeyToIndex(
  keys: readonly string[],
  draggedKey: string,
  insertionIndex: number,
) {
  const fromIndex = keys.indexOf(draggedKey)
  if (fromIndex < 0) return [...keys]

  const reordered = keys.filter(key => key !== draggedKey)
  const safeIndex = Math.max(0, Math.min(reordered.length, insertionIndex))
  reordered.splice(safeIndex, 0, draggedKey)
  return reordered
}

export function insertionIndexWithHysteresis(
  itemCentres: readonly number[],
  currentIndex: number,
  pointerY: number,
  margin = 10,
) {
  let insertionIndex = Math.max(0, Math.min(itemCentres.length, currentIndex))

  while (
    insertionIndex < itemCentres.length
    && pointerY > itemCentres[insertionIndex] + margin
  ) insertionIndex += 1

  while (
    insertionIndex > 0
    && pointerY < itemCentres[insertionIndex - 1] - margin
  ) insertionIndex -= 1

  return insertionIndex
}

export function draggedItemCentreY(
  initialItemTop: number,
  itemHeight: number,
  initialPointerY: number,
  pointerY: number,
) {
  return initialItemTop + itemHeight / 2 + (pointerY - initialPointerY)
}
