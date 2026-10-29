import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSavedCatalogFilters, savedCatalogFilterId, savedCatalogFilterLabel } from '../src/lib/savedCatalogFilters.ts'

const filter = (overrides = {}) => ({
  category: 'games', franchise: 'saga-alfa', folder: 'heroes/figures/ayla', search: '',
  material: 'PVC', collection: '1:12', minHeight: '25', maxHeight: '35', ...overrides,
})

test('saved folder filters show franchise and folder context in their compact label', () => {
  const label = savedCatalogFilterLabel({ search: '', franchise: 'Saga Alfa', folder: 'Ayla', category: 'Jogos', material: 'PVC' })
  assert.equal(label, 'Saga Alfa › Ayla · Jogos · PVC')
  assert.notEqual(label, savedCatalogFilterLabel({ search: '', franchise: 'Saga Alfa', folder: 'Baruk', category: 'Jogos', material: 'PVC' }))
  const longHierarchy = savedCatalogFilterLabel({
    search: '', franchise: 'Uma franquia com nome extremamente longo', folder: 'Ayla', category: 'Jogos',
  })
  assert.match(longHierarchy, /… › Ayla/, 'A long franchise name must not hide the saved folder identity')
  assert.ok(savedCatalogFilterLabel({ search: 'colecionável de armadura com capa longa' }).length <= 64)
})

test('filter identities are unambiguous when values contain legacy separators', () => {
  const left = filter({ category: 'games|movies', franchise: 'saga', folder: 'characters' })
  const right = filter({ category: 'games', franchise: 'movies|saga', folder: 'characters' })
  assert.notEqual(savedCatalogFilterId(left), savedCatalogFilterId(right))
  assert.equal(savedCatalogFilterId(filter({ search: '  ayla  ' })), savedCatalogFilterId(filter({ search: 'ayla' })))
})

test('stored filters migrate legacy IDs, normalize optional facets and deduplicate newest entries', () => {
  const current = filter()
  const stored = [
    { ...current, id: 'games|saga-alfa|heroes/figures/ayla|||PVC|1:12|25|35', label: '  Saga Alfa › Ayla  ' },
    { ...current, id: 'another-old-id', label: 'older duplicate' },
    { ...filter({ folder: 'heroes/figures/baruk' }), id: 'old', label: 'Saga Alfa › Baruk' },
    { id: 'malformed', label: 'bad', category: 'games', franchise: 'saga', folder: '', search: '', material: 7 },
  ]
  const normalized = normalizeSavedCatalogFilters(stored)
  assert.equal(normalized.length, 2)
  assert.equal(normalized[0].label, 'Saga Alfa › Ayla')
  assert.notEqual(normalized[0].id, 'games|saga-alfa|heroes/figures/ayla|||PVC|1:12|25|35')
  assert.equal(normalized[1].id, savedCatalogFilterId(filter({ folder: 'heroes/figures/baruk' })))
})

test('saved filter storage remains bounded to six unique entries', () => {
  const stored = Array.from({ length: 8 }, (_, index) => ({
    ...filter({ folder: `heroes/${index}` }), id: String(index), label: `Franquia ${index}`,
  }))
  assert.equal(normalizeSavedCatalogFilters(stored).length, 6)
})
