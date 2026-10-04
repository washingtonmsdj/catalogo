export const DEFAULT_TRANSIENT_KNOWN_MODEL_LIMIT = 500

export type KnownModelSummary = {
  name: string
  slug: string
}

export function compactKnownModelCache(
  models: Record<string, KnownModelSummary>,
  protectedIds: Iterable<string>,
  maxTransient = DEFAULT_TRANSIENT_KNOWN_MODEL_LIMIT,
) {
  const protectedSet = protectedIds instanceof Set ? protectedIds : new Set(protectedIds)
  const entries = Object.entries(models)
  const transientLimit = Math.max(0, Math.trunc(maxTransient))

  const protectedEntries = entries.filter(([id]) => protectedSet.has(id))
  const transientCandidates = entries.filter(([id]) => !protectedSet.has(id))
  const transientEntries = transientLimit > 0
    ? transientCandidates.slice(-transientLimit)
    : []

  return Object.fromEntries([...protectedEntries, ...transientEntries])
}
