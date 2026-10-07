import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const worker = fs.readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')

test('folder navigation uses materialized subtree counters', () => {
  const start = worker.indexOf('async function listFolders')
  const end = worker.indexOf('async function listCatalog', start)
  assert.ok(start >= 0 && end > start, 'listFolders não encontrado')
  const body = worker.slice(start, end)

  assert.match(body, /subtree_model_count/)
  assert.doesNotMatch(body, /COUNT\(m\.id\)/)
  assert.doesNotMatch(body, /subtree\(root_id,id\)/)
})
