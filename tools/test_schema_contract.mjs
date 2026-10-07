import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  catalogSchemaStatus,
  resetSchemaStatusCacheForTests,
} from '../worker/schemaContract.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(
  fs.readFileSync(path.join(root, 'config/catalog-schema-contract.json'), 'utf8'),
)

function fakeDb(appliedNames, calls) {
  return {
    prepare(sql) {
      calls.push({ kind: 'prepare', sql })
      return {
        bind(...values) {
          calls.push({ kind: 'bind', values })
          return {
            async all() {
              return {
                results: values
                  .filter((name) => appliedNames.has(name))
                  .map((name) => ({ name })),
              }
            },
          }
        },
      }
    },
  }
}

test('schema contract exactly matches versioned migration files', () => {
  const files = fs.readdirSync(path.join(root, 'migrations'))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()

  assert.deepEqual(contract.requiredMigrations, files)
  assert.equal(contract.latestMigration, files.at(-1))
  assert.equal(new Set(contract.requiredMigrations).size, contract.requiredMigrations.length)
})

test('schema status is ready only when every required migration is present', async () => {
  resetSchemaStatusCacheForTests()
  const calls = []
  const applied = new Set(contract.requiredMigrations)

  const status = await catalogSchemaStatus(fakeDb(applied, calls))

  assert.equal(status.ready, true)
  assert.equal(status.appliedMigrations, contract.requiredMigrations.length)
  assert.deepEqual(status.missingMigrations, [])
  assert.equal(calls.filter((item) => item.kind === 'prepare').length, 1)
})

test('healthy schema status is cached for the worker isolate', async () => {
  resetSchemaStatusCacheForTests()
  const calls = []
  const db = fakeDb(new Set(contract.requiredMigrations), calls)

  await catalogSchemaStatus(db)
  await catalogSchemaStatus(db)

  assert.equal(calls.filter((item) => item.kind === 'prepare').length, 1)
})

test('incomplete schema fails closed and is not cached', async () => {
  resetSchemaStatusCacheForTests()
  const calls = []
  const applied = new Set(contract.requiredMigrations.slice(0, -1))
  const db = fakeDb(applied, calls)

  const first = await catalogSchemaStatus(db)
  const second = await catalogSchemaStatus(db)

  assert.equal(first.ready, false)
  assert.deepEqual(first.missingMigrations, [contract.latestMigration])
  assert.equal(second.ready, false)
  assert.equal(calls.filter((item) => item.kind === 'prepare').length, 2)
})

test('schema lookup failure returns explicit not-ready state', async () => {
  resetSchemaStatusCacheForTests()
  const db = {
    prepare() {
      throw new Error('d1 unavailable')
    },
  }

  const status = await catalogSchemaStatus(db)

  assert.equal(status.ready, false)
  assert.equal(status.appliedMigrations, 0)
  assert.deepEqual(status.missingMigrations, contract.requiredMigrations)
})
