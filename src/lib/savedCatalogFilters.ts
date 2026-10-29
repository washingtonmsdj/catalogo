export type SavedCatalogFilter = {
  id: string
  label: string
  category: string
  franchise: string
  folder: string
  search: string
  material?: string
  collection?: string
  minHeight?: string
  maxHeight?: string
}

export type SavedCatalogFilterLabel = {
  search: string
  franchise?: string
  folder?: string
  category?: string
  material?: string
  collection?: string
  minHeight?: string
  maxHeight?: string
}

function compactLabel(value: string, length: number) {
  const normalized = value.trim()
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized
}

export function savedCatalogFilterLabel(input: SavedCatalogFilterLabel) {
  const search = input.search.trim()
  const franchise = input.franchise?.trim() ?? ''
  const folder = input.folder?.trim() ?? ''
  const hierarchy = folder
    ? [compactLabel(franchise, 15), compactLabel(folder, 17)].filter(Boolean).join(' › ')
    : compactLabel(franchise, 34)
  const scope = [search ? `“${compactLabel(search, 14)}”` : '', hierarchy]
    .filter(Boolean)
  const facets = [input.category, input.material, input.collection,
    input.minHeight && `≥ ${input.minHeight} cm`, input.maxHeight && `≤ ${input.maxHeight} cm`]
    .filter((value): value is string => Boolean(value?.trim()))
  return [...scope, ...facets].join(' · ').slice(0, 64) || 'Meu filtro'
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

export function savedCatalogFilterId(filter: Omit<SavedCatalogFilter, 'id' | 'label'>) {
  return JSON.stringify([
    filter.category,
    filter.franchise,
    filter.folder,
    filter.search.trim(),
    filter.material?.trim() ?? '',
    filter.collection?.trim() ?? '',
    filter.minHeight?.trim() ?? '',
    filter.maxHeight?.trim() ?? '',
  ])
}

export function normalizeSavedCatalogFilters(value: unknown): SavedCatalogFilter[] {
  if (!Array.isArray(value)) return []

  const filters: SavedCatalogFilter[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<SavedCatalogFilter>
    if (typeof candidate.label !== 'string' || !candidate.label.trim()
      || typeof candidate.category !== 'string' || typeof candidate.franchise !== 'string'
      || typeof candidate.folder !== 'string' || typeof candidate.search !== 'string'
      || !optionalString(candidate.material) || !optionalString(candidate.collection)
      || !optionalString(candidate.minHeight) || !optionalString(candidate.maxHeight)) continue

    const filter: SavedCatalogFilter = {
      id: '',
      label: candidate.label.trim().slice(0, 64),
      category: candidate.category,
      franchise: candidate.franchise,
      folder: candidate.folder,
      search: candidate.search.trim(),
      material: candidate.material?.trim() ?? '',
      collection: candidate.collection?.trim() ?? '',
      minHeight: candidate.minHeight?.trim() ?? '',
      maxHeight: candidate.maxHeight?.trim() ?? '',
    }
    filter.id = savedCatalogFilterId(filter)
    if (seen.has(filter.id)) continue
    seen.add(filter.id)
    filters.push(filter)
    if (filters.length === 6) break
  }
  return filters
}
