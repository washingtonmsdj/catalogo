export type AliasDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results: T[] }>
    }
  }
}

export async function resolvePublicModelIds(
  db: AliasDatabase,
  requestedIds: string[],
): Promise<string[] | null> {
  if (!requestedIds.length) return []
  const placeholders = requestedIds.map(() => '?').join(',')
  const result = await db.prepare(`SELECT
requested.id AS requested_id,
resolved.id AS canonical_id
FROM models requested
LEFT JOIN model_gallery_members member ON member.source_model_id=requested.id
JOIN models resolved ON resolved.id=COALESCE(member.canonical_model_id,requested.id)
WHERE requested.id IN (${placeholders})
  AND resolved.published=1`).bind(...requestedIds).all<{
    requested_id: string
    canonical_id: string
  }>()

  const byRequested = new Map(
    result.results.map((row) => [row.requested_id, row.canonical_id]),
  )
  if (byRequested.size !== requestedIds.length) return null

  const seen = new Set<string>()
  const canonicalIds: string[] = []
  for (const requestedId of requestedIds) {
    const canonicalId = byRequested.get(requestedId)
    if (!canonicalId) return null
    if (seen.has(canonicalId)) continue
    seen.add(canonicalId)
    canonicalIds.push(canonicalId)
  }
  return canonicalIds
}

export const RESOLVED_MODEL_BY_SLUG_CTE = `WITH resolved_model AS (
  SELECT COALESCE(member.canonical_model_id,requested.id) AS id
  FROM models requested
  LEFT JOIN model_gallery_members member ON member.source_model_id=requested.id
  WHERE requested.slug=?
)`
