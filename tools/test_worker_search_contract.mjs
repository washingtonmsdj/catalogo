import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const worker = fs.readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')
const client = fs.readFileSync(new URL('../src/services/catalogApi.ts', import.meta.url), 'utf8')

function section(startMarker, endMarker) {
  const start = worker.indexOf(startMarker)
  const end = worker.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `seção não encontrada: ${startMarker}`)
  return worker.slice(start, end)
}

test('Worker responses are no-store by default and require explicit cache opt-in', () => {
  const body = section('function json(', 'function options')

  assert.match(body, /cacheControl = 'no-store'/)
  assert.match(body, /headers\.set\('cache-control', cacheControl\)/)
})

test('public catalog reads opt into bounded edge caching', () => {
  const catalog = section('async function listCatalog', 'async function listRecentCatalog')
  const recent = section('async function listRecentCatalog', 'async function getModel')

  assert.match(catalog, /'public, max-age=30, s-maxage=120'/)
  assert.match(recent, /'public, max-age=30, s-maxage=120'/)
})

test('catalog search never returns unpublished model rows from FTS', () => {
  const body = section('async function listCatalog', 'async function listRecentCatalog')

  assert.match(body, /const where = \['m\.published = 1'\]/)
  assert.match(body, /JOIN models_fts ON models_fts\.model_id = m\.id/)
  assert.match(body, /models_fts MATCH \?/)
})

test('catalog attribute facets use bound values and are applied before cursor paging', () => {
  const body = section('async function listCatalog', 'async function listRecentCatalog')
  const cursorPosition = body.indexOf('if (cursor)')

  assert.match(client, /material: query\.material\?\.trim\(\)/)
  assert.match(client, /collection: query\.collection\?\.trim\(\)/)
  assert.match(client, /minHeight: query\.minHeight/)
  assert.match(client, /maxHeight: query\.maxHeight/)
  assert.match(body, /LOWER\(COALESCE\(m\.material, \\'\\\'\)\) LIKE LOWER\(\?\)/)
  assert.match(body, /LOWER\(COALESCE\(m\.collection, \\'\\\'\)\) LIKE LOWER\(\?\)/)
  assert.match(body, /m\.height_cm >= \?/)
  assert.match(body, /m\.height_cm <= \?/)
  assert.match(body, /return json\(request, env, \{ error: 'invalid_height_range' \}, \{ status: 400 \}\)/)
  assert.ok(body.indexOf("if (material)") < cursorPosition)
  assert.ok(body.indexOf("if (collection)") < cursorPosition)
  assert.ok(body.indexOf("if (minHeight !== null") < cursorPosition)
})

test('recent feed only exposes published models', () => {
  const body = section('async function listRecentCatalog', 'async function getModel')

  assert.match(body, /WHERE m\.published=1/)
})

test('resolved legacy slug still requires published canonical model', () => {
  const body = section('async function getModel', 'async function listImages')

  assert.match(body, /JOIN models m ON m\.id=resolved\.id/)
  assert.match(body, /WHERE m\.published=1 LIMIT 1/)
})
