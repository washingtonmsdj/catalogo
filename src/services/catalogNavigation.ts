export type DiscoveryScope = {
  category: string
  franchise: string
  search: string
}

const MAX_SCOPE_VALUE_LENGTH = 120

function safeParam(value: string | null, fallback: string) {
  const normalized = value?.trim() ?? ''
  if (!normalized || normalized.length > MAX_SCOPE_VALUE_LENGTH) return fallback
  return normalized
}

export function readDiscoveryScope(url = new URL(window.location.href)): DiscoveryScope {
  return {
    category: safeParam(url.searchParams.get('categoria'), 'all'),
    franchise: safeParam(url.searchParams.get('franquia'), 'all'),
    search: safeParam(url.searchParams.get('q'), ''),
  }
}

function applyDiscoveryScope(url: URL, scope: DiscoveryScope) {
  const category = scope.category.trim()
  const franchise = scope.franchise.trim()
  const search = scope.search.trim()

  if (category && category !== 'all') url.searchParams.set('categoria', category)
  else url.searchParams.delete('categoria')

  if (franchise && franchise !== 'all') url.searchParams.set('franquia', franchise)
  else url.searchParams.delete('franquia')

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
