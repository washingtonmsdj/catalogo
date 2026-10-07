import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  RESOLVED_MODEL_BY_SLUG_CTE,
  resolvePublicModelIds,
} from '../worker/modelAliases.ts'

function fakeDb(mapping) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() {
              const results = []
              for (const requestedId of values) {
                const canonicalId = mapping.get(requestedId)
                if (canonicalId) results.push({ requested_id: requestedId, canonical_id: canonicalId })
              }
              return { results }
            },
          }
        },
      }
    },
  }
}

test('legacy ids resolve to canonical ids while preserving first-seen order', async () => {
  const db = fakeDb(new Map([
    ['legacy-front', 'canonical'],
    ['legacy-back', 'canonical'],
    ['other', 'other'],
  ]))

  const result = await resolvePublicModelIds(db, ['legacy-front', 'other', 'legacy-back'])

  assert.deepEqual(result, ['canonical', 'other'])
})

test('unknown or unavailable model fails closed', async () => {
  const db = fakeDb(new Map([['known', 'known']]))

  assert.equal(await resolvePublicModelIds(db, ['known', 'missing']), null)
})

test('empty id list is a valid empty resolution', async () => {
  const db = fakeDb(new Map())

  assert.deepEqual(await resolvePublicModelIds(db, []), [])
})

test('slug resolution cte maps source slug to canonical model id', () => {
  assert.match(RESOLVED_MODEL_BY_SLUG_CTE, /member\.source_model_id=requested\.id/)
  assert.match(RESOLVED_MODEL_BY_SLUG_CTE, /COALESCE\(member\.canonical_model_id,requested\.id\)/)
  assert.match(RESOLVED_MODEL_BY_SLUG_CTE, /requested\.slug=\?/)
})

test('worker model detail and gallery both use slug alias resolution', () => {
  const worker = fs.readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')
  const occurrences = worker.match(/RESOLVED_MODEL_BY_SLUG_CTE/g) ?? []

  assert.ok(occurrences.length >= 3, 'import + getModel + listImages devem usar o contrato de alias')
  assert.match(worker, /resolvePublicModelIds\(env\.DB, requestedModelIds\)/)
})

test('shared collections resolve old ids and old stored items', () => {
  const source = fs.readFileSync(new URL('../worker/sharedCollections.ts', import.meta.url), 'utf8')

  assert.match(source, /resolvePublicModelIds\(env\.DB, requestedModelIds\)/)
  assert.match(source, /LEFT JOIN model_gallery_members member ON member\.source_model_id=requested\.id/)
  assert.match(source, /resolved\.id=COALESCE\(member\.canonical_model_id,requested\.id\)/)
  assert.match(source, /seen\.has\(item\.id\)/)
})
