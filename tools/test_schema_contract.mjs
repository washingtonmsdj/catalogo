import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  catalogSchemaStatus,
  FAILED_SCHEMA_RECHECK_MS,
  resetSchemaStatusCacheForTests,
} from '../worker/schemaContract.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(
  fs.readFileSync(path.join(root, 'config/catalog-schema-contract.json'), 'utf8'),
)

function structureKeys() {
  const keys = []
  for (const [plural, type] of [
    ['tables', 'table'],
    ['indexes', 'index'],
    ['triggers', 'trigger'],
  ]) {
    for (const name of contract.requiredObjects[plural]) keys.push(`${type}:${name}`)
  }
  for (const [table, columns] of Object.entries(contract.requiredObjects.columns)) {
    for (const column of columns) keys.push(`column:${table}.${column}`)
  }
  return keys
}

function fakeDb(appliedNames, calls, missingStructures = new Set()) {
  return {
    prepare(sql) {
      calls.push({ kind: 'prepare', sql })
      return {
        bind(...values) {
          calls.push({ kind: 'bind', sql, values })
          return {
            async all() {
              if (sql.includes('FROM d1_migrations')) {
                return {
                  results: values
                    .filter((name) => appliedNames.has(name))
                    .map((name) => ({ name })),
                }
              }
              if (sql.includes('FROM sqlite_schema')) {
                const results = []
                for (let index = 0; index < values.length; index += 2) {
                  const type = values[index]
                  const name = values[index + 1]
                  if (!missingStructures.has(`${type}:${name}`)) results.push({ type, name })
                }
                return { results }
              }
              const table = sql.match(/pragma_table_info\('([^']+)'\)/)?.[1]
              if (table) {
                return {
                  results: values
                    .filter((name) => !missingStructures.has(`column:${table}.${name}`))
                    .map((name) => ({ name })),
                }
              }
              throw new Error(`unexpected schema query: ${sql}`)
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
  assert.ok(Number.isSafeInteger(contract.version) && contract.version >= 1)
  assert.equal(new Set(structureKeys()).size, structureKeys().length)
})

test('schema status is ready only when migrations and physical structures exist', async () => {
  resetSchemaStatusCacheForTests()
  const calls = []
  const applied = new Set(contract.requiredMigrations)

  const status = await catalogSchemaStatus(fakeDb(applied, calls))

  assert.equal(status.ready, true)
  assert.equal(status.appliedMigrations, contract.requiredMigrations.length)
  assert.deepEqual(status.missingMigrations, [])
  assert.equal(status.verifiedStructures, structureKeys().length)
  assert.deepEqual(status.missingStructures, [])
  assert.ok(calls.filter((item) => item.kind === 'prepare').length >= 3)
})

test('healthy schema status is cached for the worker isolate', async () => {
  resetSchemaStatusCacheForTests()
  const calls = []
  const db = fakeDb(new Set(contract.requiredMigrations), calls)

  await catalogSchemaStatus(db)
  const preparesAfterFirst = calls.filter((item) => item.kind === 'prepare').length
  await catalogSchemaStatus(db)

  assert.ok(preparesAfterFirst >= 3)
  assert.equal(calls.filter((item) => item.kind === 'prepare').length, preparesAfterFirst)
})

test('incomplete migrations fail closed and recheck only after bounded cooldown', async (t) => {
  resetSchemaStatusCacheForTests()
  let clock = 1_000_000
  t.mock.method(Date, 'now', () => clock)
  const calls = []
  const applied = new Set(contract.requiredMigrations.slice(0, -1))
  const db = fakeDb(applied, calls)

  const first = await catalogSchemaStatus(db)
  const second = await catalogSchemaStatus(db)

  assert.equal(first.ready, false)
  assert.deepEqual(first.missingMigrations, [contract.latestMigration])
  assert.equal(first.verifiedStructures, 0)
  assert.deepEqual(first.missingStructures, structureKeys())
  assert.equal(second.ready, false)
  assert.equal(calls.filter((item) => item.kind === 'prepare').length, 1)

  clock += FAILED_SCHEMA_RECHECK_MS - 1
  await catalogSchemaStatus(db)
  assert.equal(calls.filter((item) => item.kind === 'prepare').length, 1)

  clock += 1
  await catalogSchemaStatus(db)
  assert.equal(calls.filter((item) => item.kind === 'prepare').length, 2)
  assert.equal(calls.some((item) => item.sql?.includes('sqlite_schema')), false)
})

test('recorded migrations with missing physical object fail closed', async () => {
  resetSchemaStatusCacheForTests()
  const calls = []
  const missing = new Set(['trigger:trg_gallery_members_retire_source'])

  const status = await catalogSchemaStatus(
    fakeDb(new Set(contract.requiredMigrations), calls, missing),
  )

  assert.equal(status.ready, false)
  assert.deepEqual(status.missingMigrations, [])
  assert.deepEqual(status.missingStructures, ['trigger:trg_gallery_members_retire_source'])
  assert.equal(status.verifiedStructures, structureKeys().length - 1)
})

test('recorded migrations with missing materialized column fail closed', async () => {
  resetSchemaStatusCacheForTests()
  const calls = []
  const missing = new Set(['column:catalog_folders.subtree_model_count'])

  const status = await catalogSchemaStatus(
    fakeDb(new Set(contract.requiredMigrations), calls, missing),
  )

  assert.equal(status.ready, false)
  assert.deepEqual(status.missingStructures, ['column:catalog_folders.subtree_model_count'])
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
  assert.deepEqual(status.missingMigrations, []) // unknown, not proved missing
  assert.equal(status.verifiedStructures, 0)
  assert.deepEqual(status.missingStructures, []) // unknown, not proved missing
  assert.equal(status.errorCode, 'schema_query_unavailable')
})


test('quota exhaustion is not misrepresented as 21 missing migrations', async () => {
  resetSchemaStatusCacheForTests()
  const status = await catalogSchemaStatus({prepare() { throw Error('D1 error 7500 daily row read limit; AUTH_TOKEN=secret-do-not-echo') }})
  assert.equal(status.ready, false)
  assert.equal(status.errorCode, 'd1_daily_read_quota_exceeded')
  assert.deepEqual(status.missingMigrations, [])
  assert.deepEqual(status.missingStructures, [])
  assert.ok(!JSON.stringify(status).includes('secret-do-not-echo'))
})

test('cold-start concurrency shares a single full schema audit', async () => {
  resetSchemaStatusCacheForTests()
  const calls = []
  const db = fakeDb(new Set(contract.requiredMigrations), calls)
  const statuses = await Promise.all(Array.from({ length: 40 }, () => catalogSchemaStatus(db)))
  assert.ok(statuses.every(status => status.ready))
  const prepareCount = calls.filter(item => item.kind === 'prepare').length
  assert.ok(prepareCount >= 3)
  assert.ok(prepareCount <= 1 + Object.keys(contract.requiredObjects.columns).length + 1)
  await catalogSchemaStatus(db)
  assert.equal(calls.filter(item => item.kind === 'prepare').length, prepareCount)
})

test('quota failure is cached only briefly and does not leak as healthy', async (t) => {
  resetSchemaStatusCacheForTests()
  let clock = 2_000_000
  t.mock.method(Date, 'now', () => clock)
  let quotaBlocked = true
  let prepares = 0
  const liveDb = fakeDb(new Set(contract.requiredMigrations), [])
  const db = {
    prepare(sql) {
      prepares += 1
      if (quotaBlocked) throw Error('D1 error 7500: free tier row read limit')
      return liveDb.prepare(sql)
    },
  }

  const blocked = await Promise.all(Array.from({ length: 30 }, () => catalogSchemaStatus(db)))
  assert.ok(blocked.every(status => !status.ready && status.errorCode === 'd1_daily_read_quota_exceeded'))
  assert.equal(prepares, 1, 'only one attempt when D1 is blocked')

  quotaBlocked = false
  clock += FAILED_SCHEMA_RECHECK_MS - 1
  const stillBlocked = await catalogSchemaStatus(db)
  assert.equal(stillBlocked.ready, false, 'do not claim recovery without a new query')
  assert.equal(prepares, 1)

  clock += 1
  const recovered = await catalogSchemaStatus(db)
  assert.equal(recovered.ready, true, 'new audit after cooldown proves recovery')
  const countAfterRecovery = prepares
  clock += FAILED_SCHEMA_RECHECK_MS * 2
  const remainsHealthy = await catalogSchemaStatus(db)
  assert.equal(remainsHealthy.ready, true)
  assert.equal(prepares, countAfterRecovery, 'healthy isolate never repeats schema audit')
})
