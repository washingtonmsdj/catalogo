import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const apiBase = 'https://catalog-cursor-fill.example.test'
const legacySlugs = [
  'dragon-ball-androide-18-traje-casual-frente',
  'dragon-ball-androide-18-traje-casual-lateral',
  'dragon-ball-androide-18-traje-casual-costas',
  'dragon-ball-androide-18-traje-casual-frente-alternativo',
]

const row = (slug, index, legacy = false) => ({
  id: `model-${index}`,
  slug,
  code: `T-${index}`,
  name: legacy ? 'Androide 18 traje casual' : `Modelo ${index}`,
  variant_name: '',
  franchise: legacy ? 'Dragon Ball' : 'Saga de teste',
  franchise_slug: legacy ? 'dragon-ball' : 'saga-teste',
  category: legacy ? 'Animes e desenhos' : 'Jogos',
  category_slug: legacy ? 'animes-desenhos' : 'games',
  collection: '',
  folder_path: legacy ? 'androides/androide-18' : 'acervo',
  image_count: 1,
  gallery_version: 1,
  cover_storage_key: null,
  material: 'Resina',
  height_cm: 20,
})

const rows = [
  row('regular-0', 0),
  ...legacySlugs.map((slug, index) => row(slug, index + 1, true)),
  ...Array.from({ length: 6 }, (_, index) => row(`regular-${index + 1}`, index + 100)),
]
const bySlug = new Map(rows.map(item => [item.slug, item]))
const catalogCalls = []
let stalledCursor = false
let stalledCursorReads = 0

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

globalThis.fetch = async input => {
  const url = new URL(String(input))
  if (url.origin !== apiBase) throw new Error(`unexpected_origin:${url.origin}`)
  if (url.pathname === '/api/catalog') {
    const cursor = url.searchParams.get('cursor')
    const limit = Number(url.searchParams.get('limit'))
    catalogCalls.push({ cursor, limit })
    if (stalledCursor) {
      const index = stalledCursorReads++
      return json({ items: [row(`stalled-${index}`, 1000 + index)], nextCursor: 'stalled-cursor' })
    }
    const offset = cursor ? Number(cursor.replace('raw-', '')) : 0
    const page = rows.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    return json({ items: page, nextCursor: nextOffset < rows.length ? `raw-${nextOffset}` : null })
  }
  const detailMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/)
  if (detailMatch) {
    const slug = decodeURIComponent(detailMatch[1])
    const model = bySlug.get(slug)
    return model ? json({ ...model, description: '' }) : json({ error: 'model_not_found' }, 404)
  }
  const imageMatch = url.pathname.match(/^\/api\/models\/([^/]+)\/images$/)
  if (imageMatch) {
    const slug = decodeURIComponent(imageMatch[1])
    const index = legacySlugs.indexOf(slug)
    return json({
      items: [{
        id: `image-${index}`,
        role: 'cover',
        width: 640,
        height: 640,
        bytes: 1000,
        mime: 'image/webp',
        qualityScore: 1,
        sourceSha256: String(index + 1).padStart(64, '0'),
        variantKeys: { card: `card/${index}.webp`, detail: `detail/${index}.webp` },
      }],
      nextCursor: null,
      total: 1,
      version: 1,
    })
  }
  throw new Error(`unexpected_request:${url.pathname}`)
}

test('live catalog fills visible pages and carries consolidated legacy groups across cursors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-api-cursor-fill-'))
  const bundlePath = join(directory, 'catalogApi.mjs')
  try {
    await build({
      entryPoints: [fileURLToPath(new URL('../src/services/catalogApi.ts', import.meta.url))],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'bundle',
      define: {
        'import.meta.env': JSON.stringify({ VITE_CATALOG_MODE: 'live', VITE_API_BASE_URL: apiBase }),
      },
      logLevel: 'silent',
    })
    const { listCatalogModels } = await import(`${pathToFileURL(bundlePath).href}?run=${Date.now()}`)

    const first = await listCatalogModels({ limit: 2 })
    assert.deepEqual(first.items.map(item => item.slug), [
      'regular-0',
      legacySlugs[0],
    ])
    assert.match(first.nextCursor, /^tcs-page-v1\./)

    const second = await listCatalogModels({ limit: 2, cursor: first.nextCursor })
    assert.deepEqual(second.items.map(item => item.slug), ['regular-1', 'regular-2'])
    assert.match(second.nextCursor, /^tcs-page-v1\./)

    const third = await listCatalogModels({ limit: 2, cursor: second.nextCursor })
    assert.deepEqual(third.items.map(item => item.slug), ['regular-3', 'regular-4'])

    const all = [...first.items, ...second.items, ...third.items]
    assert.equal(all.length, new Set(all.map(item => item.id)).size)
    assert.deepEqual(catalogCalls, [
      { cursor: null, limit: 2 },
      { cursor: 'raw-2', limit: 2 },
      { cursor: 'raw-4', limit: 2 },
      { cursor: 'raw-6', limit: 1 },
      { cursor: 'raw-7', limit: 2 },
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('live catalog fails closed when the Worker repeats a page cursor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-api-stalled-cursor-'))
  const bundlePath = join(directory, 'catalogApi.mjs')
  const before = catalogCalls.length
  stalledCursor = true
  stalledCursorReads = 0
  try {
    await build({
      entryPoints: [fileURLToPath(new URL('../src/services/catalogApi.ts', import.meta.url))],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'bundle',
      define: {
        'import.meta.env': JSON.stringify({ VITE_CATALOG_MODE: 'live', VITE_API_BASE_URL: apiBase }),
      },
      logLevel: 'silent',
    })
    const { listCatalogModels } = await import(`${pathToFileURL(bundlePath).href}?stalled=${Date.now()}`)
    await assert.rejects(listCatalogModels({ limit: 2 }), /catalog_cursor_did_not_advance/)
    assert.equal(stalledCursorReads, 2)
    assert.equal(catalogCalls.length - before, 2)
  } finally {
    stalledCursor = false
    await rm(directory, { recursive: true, force: true })
  }
})

test('malformed client page cursor fails closed without contacting the API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-api-invalid-cursor-'))
  const bundlePath = join(directory, 'catalogApi.mjs')
  const before = catalogCalls.length
  try {
    await build({
      entryPoints: [fileURLToPath(new URL('../src/services/catalogApi.ts', import.meta.url))],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'bundle',
      define: {
        'import.meta.env': JSON.stringify({ VITE_CATALOG_MODE: 'live', VITE_API_BASE_URL: apiBase }),
      },
      logLevel: 'silent',
    })
    const { listCatalogModels } = await import(`${pathToFileURL(bundlePath).href}?invalid=${Date.now()}`)
    await assert.rejects(listCatalogModels({ cursor: 'tcs-page-v1.%%%bad' }), /invalid_catalog_page_cursor/)
    assert.equal(catalogCalls.length, before)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
