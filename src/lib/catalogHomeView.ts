export type CatalogHomeModeInput = {
  showFullCatalogPage: boolean
  pageIndex: number
  category: string
  franchise: string
  folder: string
  search: string
  searchPending: boolean
}

export function hasResolvedCatalogDiscovery(input: CatalogHomeModeInput) {
  return (
    input.category !== 'all'
    || input.franchise !== 'all'
    || Boolean(input.folder)
    || Boolean(input.search.trim() && !input.searchPending)
  )
}

export function isCatalogResultsMode(input: CatalogHomeModeInput) {
  return input.showFullCatalogPage || input.pageIndex > 0 || hasResolvedCatalogDiscovery(input)
}

export function modelsForCatalogHome<T>(models: readonly T[], resultsMode: boolean, editorialLimit = 6): T[] {
  if (resultsMode) return [...models]
  return models.slice(0, Math.max(0, Math.trunc(editorialLimit)))
}
