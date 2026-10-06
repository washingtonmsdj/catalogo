import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasResolvedCatalogDiscovery,
  isCatalogResultsMode,
  modelsForCatalogHome,
} from '../src/lib/catalogHomeView.ts'

const base = {
  showFullCatalogPage: false,
  pageIndex: 0,
  category: 'all',
  franchise: 'all',
  folder: '',
  search: '',
  searchPending: false,
}

test('editorial home keeps only the six highlighted models', () => {
  const models = Array.from({ length: 24 }, (_, index) => index + 1)
  assert.equal(isCatalogResultsMode(base), false)
  assert.deepEqual(modelsForCatalogHome(models, false), [1, 2, 3, 4, 5, 6])
})

test('full results preserve all models already returned by the API page', () => {
  const models = Array.from({ length: 24 }, (_, index) => index + 1)
  assert.equal(modelsForCatalogHome(models, true).length, 24)
  assert.deepEqual(modelsForCatalogHome(models, true), models)
})

test('applied filters and later pages enter results mode', () => {
  assert.equal(isCatalogResultsMode({ ...base, category: 'games' }), true)
  assert.equal(isCatalogResultsMode({ ...base, franchise: 'god-of-war' }), true)
  assert.equal(isCatalogResultsMode({ ...base, folder: 'kratos' }), true)
  assert.equal(isCatalogResultsMode({ ...base, pageIndex: 1 }), true)
  assert.equal(isCatalogResultsMode({ ...base, showFullCatalogPage: true }), true)
})

test('a valid applied search enters results mode', () => {
  const input = { ...base, search: 'kratos', searchPending: false }
  assert.equal(hasResolvedCatalogDiscovery(input), true)
  assert.equal(isCatalogResultsMode(input), true)
})

test('a short search that is not yet applied keeps editorial mode', () => {
  const input = { ...base, search: 'kr', searchPending: true }
  assert.equal(hasResolvedCatalogDiscovery(input), false)
  assert.equal(isCatalogResultsMode(input), false)
})
