export const formatPendingConflicts = (conflicted: number, blocked: number): string | undefined => {
  const parts: string[] = []
  if (conflicted > 0) parts.push(`${conflicted} conflicted`)
  if (blocked > 0) parts.push(`${blocked} blocked`)
  return parts.length === 0 ? undefined : parts.join("  ")
}
