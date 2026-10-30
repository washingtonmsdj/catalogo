export const CATALOG_COLLECTION_QUERY_PARAM = 'colecao-modelo'
export const SHARED_COLLECTION_QUERY_PARAM = 'colecao-link'

export function isSharedCollectionCode(value: string | null | undefined): value is string {
  return Boolean(value && /^TCL-[A-Za-z0-9_-]{16}$/.test(value.trim()))
}

export function readSharedCollectionCode(url: URL) {
  const current = url.searchParams.get(SHARED_COLLECTION_QUERY_PARAM)?.trim()
  if (isSharedCollectionCode(current)) return current

  // Old links used `colecao`; only their canonical TCL code shape is treated
  // as a share so legacy catalog facet links remain ordinary filters.
  const legacy = url.searchParams.get('colecao')?.trim()
  return isSharedCollectionCode(legacy) ? legacy : ''
}

export function buildSharedCollectionUrl(code: string, currentUrl: URL) {
  const url = new URL(currentUrl.toString())
  url.search = ''
  url.hash = ''
  url.searchParams.set(SHARED_COLLECTION_QUERY_PARAM, code)
  return url.toString()
}

export type DiscoveryScope = {
  category: string
  franchise: string
  folder: string
  search: string
  material: string
  collection: string
  minHeight: string
  maxHeight: string
}

const MAX_SCOPE_VALUE_LENGTH = 120
const MAX_FOLDER_VALUE_LENGTH = 240

function safeParam(value: string | null, fallback: string, maxLength = MAX_SCOPE_VALUE_LENGTH) {
  const normalized = value?.trim() ?? ''
  if (!normalized || normalized.length > maxLength) return fallback
  return normalized
}

export function readDiscoveryScope(url = new URL(window.location.href)): DiscoveryScope {
  return {
    category: safeParam(url.searchParams.get('categoria'), 'all'),
    franchise: safeParam(url.searchParams.get('franquia'), 'all'),
    folder: safeParam(url.searchParams.get('pasta'), '', MAX_FOLDER_VALUE_LENGTH),
    search: safeParam(url.searchParams.get('q'), ''),
    material: safeParam(url.searchParams.get('material'), ''),
    collection: safeParam(url.searchParams.get(CATALOG_COLLECTION_QUERY_PARAM), '')
      || (isSharedCollectionCode(url.searchParams.get('colecao')) ? '' : safeParam(url.searchParams.get('colecao'), '')),
    minHeight: safeHeight(url.searchParams.get('altura-min')),
    maxHeight: safeHeight(url.searchParams.get('altura-max')),
  }
}

function safeHeight(value: string | null) {
  if (!value || value.length > 4 || !/^\d{1,3}$/.test(value)) return ''
  const height = Number(value)
  return height >= 1 && height <= 300 ? String(height) : ''
}

function applyDiscoveryScope(url: URL, scope: DiscoveryScope) {
  const category = scope.category.trim()
  const franchise = scope.franchise.trim()
  const folder = scope.folder.trim()
  const search = scope.search.trim()
  const material = scope.material.trim()
  const collection = scope.collection.trim()
  const minHeight = safeHeight(scope.minHeight)
  const maxHeight = safeHeight(scope.maxHeight)

  if (category && category !== 'all') url.searchParams.set('categoria', category)
  else url.searchParams.delete('categoria')

  if (franchise && franchise !== 'all') url.searchParams.set('franquia', franchise)
  else url.searchParams.delete('franquia')

  if (folder && franchise && franchise !== 'all') url.searchParams.set('pasta', folder)
  else url.searchParams.delete('pasta')

  if (search) url.searchParams.set('q', search)
  else url.searchParams.delete('q')

  if (material) url.searchParams.set('material', material.slice(0, MAX_SCOPE_VALUE_LENGTH))
  else url.searchParams.delete('material')

  if (collection) url.searchParams.set(CATALOG_COLLECTION_QUERY_PARAM, collection.slice(0, MAX_SCOPE_VALUE_LENGTH))
  else url.searchParams.delete(CATALOG_COLLECTION_QUERY_PARAM)
  const legacyCollection = url.searchParams.get('colecao')
  if (legacyCollection && !isSharedCollectionCode(legacyCollection)) url.searchParams.delete('colecao')

  if (minHeight) url.searchParams.set('altura-min', minHeight)
  else url.searchParams.delete('altura-min')

  if (maxHeight) url.searchParams.set('altura-max', maxHeight)
  else url.searchParams.delete('altura-max')
}

export function replaceDiscoveryScope(scope: DiscoveryScope) {
  const url = new URL(window.location.href)
  applyDiscoveryScope(url, scope)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function discoveryShareUrl(scope: DiscoveryScope, currentUrl = new URL(window.location.href)) {
  const url = new URL(currentUrl.toString())
  applyDiscoveryScope(url, scope)
  url.hash = ''
  return url.toString()
}
