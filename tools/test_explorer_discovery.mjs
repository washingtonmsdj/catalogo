import assert from 'node:assert/strict'
import test from 'node:test'

import { explorerScopeKey, resolveExplorerSnapshot } from '../src/lib/explorerDiscovery.ts'

const kratos = { id: 'kratos', name: 'Kratos' }
const franchise = { id: 'god-of-war', label: 'God of War' }
const key = explorerScopeKey('games', 'kratos')
const snapshot = {
  scopeKey: key,
  franchises: [franchise],
  models: [kratos],
  truncated: true,
  error: '',
}

test('only the matching category and term may display a live result', () => {
  assert.deepEqual(resolveExplorerSnapshot(key, snapshot).models, [kratos])
  assert.deepEqual(resolveExplorerSnapshot(key, snapshot).franchises, [franchise])
  for (const next of [
    explorerScopeKey('all', 'kratos'),
    explorerScopeKey('games', 'mario'),
    explorerScopeKey('games', ''),
  ]) {
    const state = resolveExplorerSnapshot(next, snapshot)
    assert.equal(state.ready, false)
    assert.deepEqual(state.models, [])
    assert.deepEqual(state.franchises, [])
    assert.equal(state.truncated, false)
  }
})

test('debounce and pending lookup never expose models from an earlier query to Enter', () => {
  const prior = resolveExplorerSnapshot(key, snapshot)
  assert.equal(prior.ready, true)
  const inFlight = resolveExplorerSnapshot(explorerScopeKey('games', 'sonic'), snapshot)
  assert.equal(inFlight.ready, false)
  assert.equal(inFlight.models[0], undefined)
  assert.equal(inFlight.franchises[0], undefined)
})

test('same term with trailing whitespace preserves identity without duplicated network data', () => {
  assert.equal(explorerScopeKey('games', 'kratos '), key)
  assert.equal(explorerScopeKey('games', ' kratos'), key)
  assert.notEqual(explorerScopeKey('games', 'Kratos'), key)
})

test('errors and truncation belong only to the lookup that produced them', () => {
  const failed = { ...snapshot, franchises: [], models: [], error: 'Falha ao consultar' }
  const active = resolveExplorerSnapshot(key, failed)
  assert.equal(active.ready, true)
  assert.equal(active.error, 'Falha ao consultar')
  assert.equal(resolveExplorerSnapshot(explorerScopeKey('games', 'novo'), failed).error, '')
  assert.equal(resolveExplorerSnapshot(explorerScopeKey('games', 'novo'), failed).truncated, false)
  assert.equal(resolveExplorerSnapshot(key, null).ready, false)
})

test('scope key cannot alias a category containing separators with a search term', () => {
  assert.notEqual(explorerScopeKey('games,pc', 'a'), explorerScopeKey('games', 'pc,a'))
})
