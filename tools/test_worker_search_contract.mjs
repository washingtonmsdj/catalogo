import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const worker = fs.readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')

function section(startMarker, endMarker) {
  const start = worker.indexOf(startMarker)
  const end = worker.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `seção não encontrada: ${startMarker}`)
  return worker.slice(start, end)
}

test('catalog search never returns unpublished model rows from FTS', () => {
  const body = section('async function listCatalog', 'async function listRecentCatalog')

  assert.match(body, /const where = \['m\.published = 1'\]/)
  assert.match(body, /JOIN models_fts ON models_fts\.model_id = m\.id/)
  assert.match(body, /models_fts MATCH \?/)
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
