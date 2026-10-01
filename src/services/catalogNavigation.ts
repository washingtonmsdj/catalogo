export type DiscoveryScope = {
  category: string
  franchise: string
  folder: string
  search: string
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
  }
}

function applyDiscoveryScope(url: URL, scope: DiscoveryScope) {
  const category = scope.category.trim()
  const franchise = scope.franchise.trim()
  const folder = scope.folder.trim()
  const search = scope.search.trim()

  if (category && category !== 'all') url.searchParams.set('categoria', category)
  else url.searchParams.delete('categoria')

  if (franchise && franchise !== 'all') url.searchParams.set('franquia', franchise)
  else url.searchParams.delete('franquia')

  if (folder && franchise && franchise !== 'all') url.searchParams.set('pasta', folder)
  else url.searchParams.delete('pasta')

  if (search) url.searchParams.set('q', search)
  else url.searchParams.delete('q')
}

export function replaceDiscoveryScope(scope: DiscoveryScope) {
  const url = new URL(window.location.href)
  applyDiscoveryScope(url, scope)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function discoveryShareUrl(scope: DiscoveryScope) {
  const url = new URL(window.location.href)
  applyDiscoveryScope(url, scope)
  url.hash = ''
  return url.toString()
}
