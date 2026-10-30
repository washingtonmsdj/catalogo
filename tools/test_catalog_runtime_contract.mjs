import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCatalogRuntime } from '../src/config/catalogRuntimeContract.ts'
import { buildSharedCollectionUrl, discoveryShareUrl, readDiscoveryScope, readSharedCollectionCode } from '../src/services/catalogNavigation.ts'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, normalizePageSize } from '../src/services/catalogRepository.ts'

test('catalog page size stays bounded and non-finite input falls back to the default', () => {
  assert.equal(normalizePageSize(), DEFAULT_PAGE_SIZE)
  assert.equal(normalizePageSize(Number.NaN), DEFAULT_PAGE_SIZE)
  assert.equal(normalizePageSize(Number.POSITIVE_INFINITY), DEFAULT_PAGE_SIZE)
  assert.equal(normalizePageSize(12.9), 12)
  assert.equal(normalizePageSize(0), 1)
  assert.equal(normalizePageSize(MAX_PAGE_SIZE + 1), MAX_PAGE_SIZE)
})

test('live is the safe default when no API is configured', () => {
  assert.deepEqual(resolveCatalogRuntime({}), { mode: 'live', apiBase: undefined })
})

test('configured API base is normalized without changing runtime mode', () => {
  assert.deepEqual(
    resolveCatalogRuntime({ VITE_API_BASE_URL: 'https://catalog.example.test///' }),
    { mode: 'live', apiBase: 'https://catalog.example.test' },
  )
})

test('Achegue-se uses its first-party catalog proxy as the canonical API origin', () => {
  for (const hostname of ['acheguese.com.br', 'www.acheguese.com.br']) {
    assert.deepEqual(
      resolveCatalogRuntime(
        { VITE_API_BASE_URL: 'https://external.example.test' },
        { hostname, origin: `https://${hostname}` },
      ),
      { mode: 'live', apiBase: `https://${hostname}/catalogo-api` },
    )
  }
})

test('unrelated hosts keep the configured API base', () => {
  assert.deepEqual(
    resolveCatalogRuntime(
      { VITE_API_BASE_URL: 'https://api.example.test/' },
      { hostname: 'catalog.example.test', origin: 'https://catalog.example.test' },
    ),
    { mode: 'live', apiBase: 'https://api.example.test' },
  )
})

test('demo requires explicit opt-in and never inherits a live API base', () => {
  assert.deepEqual(
    resolveCatalogRuntime({ VITE_CATALOG_MODE: 'demo', VITE_API_BASE_URL: 'https://api.example.test' }),
    { mode: 'demo' },
  )
})

test('explicit live mode without API remains live and therefore fails closed at request time', () => {
  assert.deepEqual(resolveCatalogRuntime({ VITE_CATALOG_MODE: 'live' }), { mode: 'live', apiBase: undefined })
})

test('unknown runtime modes fail closed instead of silently becoming demo', () => {
  assert.throws(
    () => resolveCatalogRuntime({ VITE_CATALOG_MODE: 'preview' }),
    /catalog_runtime_mode_invalid:preview/,
  )
})

test('shareable discovery scope preserves bounded material, collection and height facets', () => {
  const scope = readDiscoveryScope(new URL('https://catalog.example.test/?material=Resina&colecao=Art%20Scale&altura-min=20&altura-max=60'))
  assert.equal(scope.material, 'Resina')
  assert.equal(scope.collection, 'Art Scale')
  assert.equal(scope.minHeight, '20')
  assert.equal(scope.maxHeight, '60')
})

test('catalog collection facets no longer collide with shared collection links', () => {
  const legacyFacetUrl = new URL('https://catalog.example.test/?colecao=Art%20Scale')
  assert.equal(readDiscoveryScope(legacyFacetUrl).collection, 'Art Scale', 'Existing facet URLs remain readable')
  assert.equal(readSharedCollectionCode(legacyFacetUrl), '', 'A legacy facet value is not treated as a share code')

  const legacyShareUrl = new URL('https://catalog.example.test/?colecao=TCL-ABCDEFGHIJKLMNOP')
  assert.equal(readDiscoveryScope(legacyShareUrl).collection, '', 'Legacy share codes are excluded from facet state')
  assert.equal(readSharedCollectionCode(legacyShareUrl), 'TCL-ABCDEFGHIJKLMNOP')

  const sharedScope = readDiscoveryScope(new URL('https://catalog.example.test/?colecao-modelo=Art%20Scale&colecao-link=TCL-ABCDEFGHIJKLMNOP'))
  assert.equal(sharedScope.collection, 'Art Scale')
  assert.equal(readSharedCollectionCode(new URL('https://catalog.example.test/?colecao-modelo=Art%20Scale&colecao-link=TCL-ABCDEFGHIJKLMNOP')), 'TCL-ABCDEFGHIJKLMNOP')

  const canonicalUrl = new URL(discoveryShareUrl({
    category: 'games', franchise: 'saga-alfa', folder: 'herois/personagens/ayla',
    search: 'Ayla', material: 'Resina', collection: 'Art Scale', minHeight: '20', maxHeight: '60',
  }, new URL('https://catalog.example.test/')))
  assert.equal(canonicalUrl.searchParams.get('categoria'), 'games')
  assert.equal(canonicalUrl.searchParams.get('franquia'), 'saga-alfa')
  assert.equal(canonicalUrl.searchParams.get('pasta'), 'herois/personagens/ayla')
  assert.equal(canonicalUrl.searchParams.get('q'), 'Ayla')
  assert.equal(canonicalUrl.searchParams.get('material'), 'Resina')
  assert.equal(canonicalUrl.searchParams.get('colecao-modelo'), 'Art Scale')
  assert.equal(canonicalUrl.searchParams.get('altura-min'), '20')
  assert.equal(canonicalUrl.searchParams.get('altura-max'), '60')
  assert.equal(canonicalUrl.searchParams.has('colecao'), false, 'New facet links use the unambiguous query key')

  const publicShareUrl = new URL(buildSharedCollectionUrl('TCL-ABCDEFGHIJKLMNOP', new URL('https://catalog.example.test/?material=PVC&colecao-modelo=Art%20Scale')))
  assert.equal(publicShareUrl.searchParams.get('colecao-link'), 'TCL-ABCDEFGHIJKLMNOP')
  assert.equal(publicShareUrl.searchParams.has('colecao'), false)
  assert.equal(publicShareUrl.searchParams.has('colecao-modelo'), false)
})

test('invalid or out-of-range height facets fail closed to no height constraint', () => {
  const scope = readDiscoveryScope(new URL('https://catalog.example.test/?altura-min=0&altura-max=999'))
  assert.equal(scope.minHeight, '')
  assert.equal(scope.maxHeight, '')
})
