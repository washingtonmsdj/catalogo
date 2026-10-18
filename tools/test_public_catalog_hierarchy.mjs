import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { verifyPublicCatalogHierarchy } from './check_public_catalog_hierarchy.mjs'

const contract = JSON.parse(readFileSync(new URL('../config/catalog-schema-contract.json', import.meta.url)))
const structures = contract.requiredObjects.tables.length +
  contract.requiredObjects.indexes.length +
  contract.requiredObjects.triggers.length +
  Object.values(contract.requiredObjects.columns).reduce((n, items) => n + items.length, 0)

const health = {
  ok: true, service: 'tonecos-catalogo',
  schema: {
    ready: true, contractVersion: contract.version,
    latestMigration: contract.latestMigration,
    appliedMigrations: contract.requiredMigrations.length,
    requiredMigrations: contract.requiredMigrations.length,
    missingMigrations: [],
    requiredStructures: structures, verifiedStructures: structures, missingStructures: [],
  },
}

function fixture(path, query, config) {
  if (path === '/api/health') return config.health || health
  if (path === '/api/categories') return { items: [
    { id: 'all', label: 'Todos', count: 2 }, { id: 'games', label: 'Jogos', count: 2 },
  ] }
  if (path === '/api/franchises') return { items: [
    { id: 'empty', category: 'games', count: 1 },
    { id: 'saga', category: 'games', count: 2 },
  ], truncated: false }
  if (path === '/api/folders') {
    if (query.get('franchise') === 'empty') return { current: null, trail: [], items: [] }
    const parent = query.get('parent')
    if (!parent) return { current: null, trail: [], items: [
      { id: 'herois', count: 1, hasChildren: true, label: 'Heróis' },
    ] }
    if (parent === 'herois') return {
      current: { id: parent, label: 'Heróis', count: 1 },
      trail: [{ id: parent, label: 'Heróis' }],
      items: [{ id: 'herois/personagens', count: 1, hasChildren: false, label: 'Personagens' }],
    }
  }
  const row = {
    id: 'm1', slug: 'personagem-um', category_slug: 'games',
    franchise_slug: 'saga', folder_path: 'herois/personagens/personagem-um',
  }
  if (path === '/api/catalog') {
    if (config.emptyCatalog) return { items: [], nextCursor: null }
    return { items: [config.outOfScope ? { ...row, folder_path: 'viloes' } : row], nextCursor: null }
  }
  if (path === '/api/models/personagem-um') return config.detailMismatch ? { ...row, slug: 'diferente' } : row
  throw new Error('Unexpected endpoint: ' + path)
}

function mockFetch(config = {}) {
  const calls = []
  const fetcher = async (url, options) => {
    assert.equal(options?.method ?? 'GET', 'GET')
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://catalog.example')
    calls.push(parsed.pathname)
    const data = fixture(parsed.pathname, parsed.searchParams, config)
    const status = config.healthHttp503 && parsed.pathname === '/api/health' ? 503 : 200
    return { ok: status === 200, status, json: async () => data }
  }
  return { fetcher, calls }
}

test('real published hierarchy journey stays read-only, bounded and contract-checked', async () => {
  const { fetcher, calls } = mockFetch()
  const result = await verifyPublicCatalogHierarchy('https://catalog.example', fetcher)
  assert.equal(result.ok, true)
  assert.equal(result.depth, 2)
  assert.equal(result.folder, 'herois/personagens')
  assert.equal(result.modelSlug, 'personagem-um')
  assert.equal(result.readOnly, true)
  assert.equal(calls.length, 8)
  assert.deepEqual(calls.slice(-2), ['/api/catalog', '/api/models/personagem-um'])
})

test('quota or unhealthy Worker fails closed without extra D1 reads', async () => {
  const { fetcher, calls } = mockFetch({ healthHttp503: true })
  await assert.rejects(verifyPublicCatalogHierarchy('https://catalog.example', fetcher), /HTTP 503/)
  assert.deepEqual(calls, ['/api/health'])
})

test('catalog scope cannot select a model from a different folder', async () => {
  const { fetcher } = mockFetch({ outOfScope: true })
  await assert.rejects(verifyPublicCatalogHierarchy('https://catalog.example', fetcher), /outside its requested hierarchy/)
})

test('detail slug must agree with catalog listing', async () => {
  const { fetcher } = mockFetch({ detailMismatch: true })
  await assert.rejects(verifyPublicCatalogHierarchy('https://catalog.example', fetcher), /detail does not match/)
})

test('no published model is an explicit failure, never a fake success', async () => {
  const { fetcher } = mockFetch({ emptyCatalog: true })
  await assert.rejects(verifyPublicCatalogHierarchy('https://catalog.example', fetcher), /no published model/)
})

test('rejects non-HTTPS, credentialed, or query-tainted bases', async () => {
  for (const bad of ['http://catalog.example', 'https://user:pass@catalog.example',
    'https://catalog.example/?x=1']) {
    await assert.rejects(verifyPublicCatalogHierarchy(bad, () => { throw Error('No network expected') }),
      /clean HTTPS API base/)
  }
})
