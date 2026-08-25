export function quizPreviewIndexForKey(
  key: string,
  code: string,
  currentIndex: number,
  itemCount: number,
) {
  if (itemCount <= 0) return null
  if (key === 'ArrowLeft') return Math.max(0, currentIndex - 1)
  if (key === 'ArrowRight' || key === ' ' || code === 'Space') {
    return Math.min(itemCount - 1, currentIndex + 1)
  }
  return null
}
