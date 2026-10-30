export type CatalogHomeModeInput = {
  showFullCatalogPage: boolean
  pageIndex: number
  category: string
  franchise: string
  folder: string
  search: string
  searchPending: boolean
  material?: string
  collection?: string
  minHeight?: string
  maxHeight?: string
}

export function hasResolvedCatalogDiscovery(input: CatalogHomeModeInput) {
  return (
    input.category !== 'all'
    || input.franchise !== 'all'
    || Boolean(input.folder)
    || Boolean(input.search.trim() && !input.searchPending)
    || Boolean(input.material || input.collection || input.minHeight || input.maxHeight)
  )
}

export function isCatalogResultsMode(input: CatalogHomeModeInput) {
  return input.showFullCatalogPage || input.pageIndex > 0 || hasResolvedCatalogDiscovery(input)
}

export function modelsForCatalogHome<T>(models: readonly T[], resultsMode: boolean, editorialLimit = 6): T[] {
  if (resultsMode) return [...models]
  return models.slice(0, Math.max(0, Math.trunc(editorialLimit)))
}

export type QuoteRailKnownModel = { name: string; slug: string }

export function quoteRailItems<T extends { id: string; name: string }>(
  selectedIds: readonly string[],
  pageModels: readonly T[],
  knownModels: Readonly<Record<string, QuoteRailKnownModel>>,
  limit = 4,
) {
  const byId = new Map(pageModels.map((model) => [model.id, model]))
  return selectedIds.slice(0, Math.max(0, Math.trunc(limit))).map((id) => {
    const model = byId.get(id)
    const known = knownModels[id]
    return { id, model, name: model?.name || known?.name, slug: known?.slug }
  })
}


export type CatalogAvailabilityInput = {
  mode: 'demo' | 'live'
  loading: boolean
  apiHealthy: boolean
  modelPageStatus: 'loading' | 'ready' | 'error' | 'not_found'
}

export function catalogPageIsUnavailable(input: CatalogAvailabilityInput) {
  return input.mode === 'live'
    && !input.loading
    && (!input.apiHealthy || input.modelPageStatus === 'error')
}
