/**
 * Scoped search identity for the explorer. A result is never reusable under
 * a different category or query, even during the debounce or next render.
 * The backend remains the SSOT of matches and pagination.
 */
export type ExplorerSnapshot<Franchise, Model> = {
  scopeKey: string
  franchises: Franchise[]
  models: Model[]
  truncated: boolean
  error: string
}

export function explorerScopeKey(category: string, query: string): string {
  return JSON.stringify([category, query.trim()])
}

export function resolveExplorerSnapshot<Franchise, Model>(
  scopeKey: string,
  snapshot: ExplorerSnapshot<Franchise, Model> | null,
): {
  ready: boolean
  franchises: Franchise[]
  models: Model[]
  truncated: boolean
  error: string
} {
  if (snapshot?.scopeKey === scopeKey) {
    return { ready: true, franchises: snapshot.franchises, models: snapshot.models,
      truncated: snapshot.truncated, error: snapshot.error }
  }
  return { ready: false, franchises: [], models: [], truncated: false, error: '' }
}
