export function nextQuizCopyTitle(title: string, existingTitles: readonly string[]) {
  const base = `${title.trim() || 'Untitled Quiz'} copy`
  const used = new Set(existingTitles.map(value => value.trim().toLocaleLowerCase()))
  if (!used.has(base.toLocaleLowerCase())) return base

  let copyNumber = 2
  while (used.has(`${base} ${copyNumber}`.toLocaleLowerCase())) copyNumber += 1
  return `${base} ${copyNumber}`
}
