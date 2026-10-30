import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../src/data/mockCatalog.ts', import.meta.url), 'utf8')
const pagination = fs.readFileSync(new URL('../src/data/demoCatalogPagination.ts', import.meta.url), 'utf8')

test('demo catalog data is guarded by explicit build-time mode', () => {
  assert.match(source, /const demoEnabled = import\.meta\.env\.VITE_CATALOG_MODE === 'demo'/)
  assert.match(source, /export const categories:[^\n]+demoEnabled \? demoCategories : \[\]/)
  assert.match(source, /export const models:[^\n]+demoEnabled \? demoModels : \[\]/)
})

test('demo catalog has no live-mode fallback branch containing fake records', () => {
  assert.doesNotMatch(source, /VITE_API_BASE_URL/)
  assert.doesNotMatch(source, /\?\s*\[\]\s*:\s*demoCategories/)
  assert.doesNotMatch(source, /\?\s*\[\]\s*:\s*demoModels/)
})

test('virtual demo variants keep the artwork paired with their model seed', () => {
  assert.match(pagination, /demoArtworkIndex: parts\.seed\.demoArtworkIndex \?\? parts\.index % 12/)
  assert.doesNotMatch(pagination, /demoArtworkIndex: index % 12/)
})

test('live runtime starts without dereferencing deliberately removed demo fixtures', () => {
  const hook = fs.readFileSync(new URL('../src/hooks/useCatalogRuntime.ts', import.meta.url), 'utf8')
  assert.match(hook, /mode === 'demo'\s*\?\s*\(demoModels\.find/)
  assert.match(hook, /demoModels\[0\]\?\.id \?\? ''/)
  assert.doesNotMatch(hook, /demoModels\[0\]\.id/)
})
