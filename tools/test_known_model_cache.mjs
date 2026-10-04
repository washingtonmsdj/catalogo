import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_TRANSIENT_KNOWN_MODEL_LIMIT,
  compactKnownModelCache,
} from '../src/services/knownModelCacheCore.ts'

function models(count) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `mdl_${index}`,
      { name: `Modelo ${index}`, slug: `modelo-${index}` },
    ]),
  )
}

test('limits transient metadata while preserving protected models', () => {
  const source = models(5_000)
  const result = compactKnownModelCache(source, new Set(['mdl_0', 'mdl_100']))

  assert.equal(DEFAULT_TRANSIENT_KNOWN_MODEL_LIMIT, 500)
  assert.equal(Object.keys(source).length, 5_000)
  assert.equal(Object.keys(result).length, 502)
  assert.equal(result.mdl_0?.slug, 'modelo-0')
  assert.equal(result.mdl_100?.slug, 'modelo-100')
  assert.equal(result.mdl_4999?.slug, 'modelo-4999')
  assert.equal(result.mdl_4499, undefined)
  assert.equal(result.mdl_4500?.slug, 'modelo-4500')
})

test('never discards protected models even when they exceed the transient limit', () => {
  const source = models(3_000)
  const protectedIds = new Set(Array.from({ length: 2_200 }, (_, index) => `mdl_${index}`))
  const result = compactKnownModelCache(source, protectedIds)

  assert.equal(Object.keys(result).length, 2_700)
  assert.equal(result.mdl_0?.name, 'Modelo 0')
  assert.equal(result.mdl_2199?.name, 'Modelo 2199')
  assert.equal(result.mdl_2499, undefined)
  assert.equal(result.mdl_2500?.name, 'Modelo 2500')
  assert.equal(result.mdl_2999?.name, 'Modelo 2999')
})

test('supports disabling transient metadata without touching protected entries', () => {
  const source = models(25)
  const result = compactKnownModelCache(source, ['mdl_2', 'mdl_7'], 0)

  assert.deepEqual(Object.keys(result), ['mdl_2', 'mdl_7'])
  assert.equal(result.mdl_2?.slug, 'modelo-2')
  assert.equal(result.mdl_7?.slug, 'modelo-7')
})
