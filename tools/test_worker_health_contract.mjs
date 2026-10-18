import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { validateWorkerHealth, verifyWorkerHealth } from './check_worker_health.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(
  fs.readFileSync(path.join(root, 'config/catalog-schema-contract.json'), 'utf8'),
)

function requiredStructureCount() {
  return contract.requiredObjects.tables.length
    + contract.requiredObjects.indexes.length
    + contract.requiredObjects.triggers.length
    + Object.values(contract.requiredObjects.columns).reduce((sum, entries) => sum + entries.length, 0)
}

function healthyPayload() {
  return {
    ok: true,
    service: 'tonecos-catalogo',
    schema: {
      ready: true,
      contractVersion: contract.version,
      latestMigration: contract.latestMigration,
      requiredMigrations: contract.requiredMigrations.length,
      appliedMigrations: contract.requiredMigrations.length,
      missingMigrations: [],
      requiredStructures: requiredStructureCount(),
      verifiedStructures: requiredStructureCount(),
      missingStructures: [],
    },
  }
}

test('accepts health only when schema contract is complete', () => {
  const result = validateWorkerHealth(healthyPayload())
  assert.equal(result.ok, true)
  assert.equal(result.latestMigration, contract.latestMigration)
})

test('rejects superficial health without schema status', () => {
  assert.throws(
    () => validateWorkerHealth({ ok: true, service: 'tonecos-catalogo' }),
    /no schema status/,
  )
})

test('rejects incomplete schema even when worker says ok', () => {
  const payload = healthyPayload()
  payload.schema.ready = false
  payload.schema.missingMigrations = [contract.latestMigration]

  assert.throws(() => validateWorkerHealth(payload), /schema is not ready/)
})

test('rejects missing physical schema object', () => {
  const payload = healthyPayload()
  payload.schema.verifiedStructures -= 1
  payload.schema.missingStructures = ['trigger:trg_gallery_members_retire_source']

  assert.throws(() => validateWorkerHealth(payload), /verified structure count mismatch/)
})

test('rejects stale worker contract', () => {
  const payload = healthyPayload()
  payload.schema.latestMigration = '0013_model_image_sources.sql'

  assert.throws(() => validateWorkerHealth(payload), /latest migration mismatch/)
})

test('HTTP 503 fails closed', async () => {
  await assert.rejects(
    () => verifyWorkerHealth('https://api.example.com', async () => ({
      ok: false,
      status: 503,
      async json() { return { error: 'schema_not_ready' } },
    })),
    /HTTP 503/,
  )
})

test('503 diagnostic includes only bounded schema metadata and never raw payload', async () => {
  const fetch = async () => ({
    ok: false, status: 503,
    async json() { return {
      schema: {
        ready: false,
        contractVersion: 5,
        appliedMigrations: 20,
        requiredMigrations: 21,
        verifiedStructures: 54,
        requiredStructures: 55,
        missingMigrations: ['0021_quote_admin_audit_events.sql'],
        missingStructures: ['table:quote_status_events'],
      },
      customer: { email: 'private@example.com' },
    } },
  })
  await assert.rejects(
    () => verifyWorkerHealth('https://api.example.com', fetch),
    (error) => {
      assert.match(error.message, /HTTP 503/)
      assert.match(error.message, /0021_quote_admin_audit_events.sql/)
      assert.match(error.message, /table:quote_status_events/)
      assert.ok(!error.message.includes('private@example.com'))
      return true
    },
  )
})

test('non-JSON 503 does not bypass fail closed or log raw response', async () => {
  await assert.rejects(
    () => verifyWorkerHealth('https://api.example.com', async () => ({
      ok: false, status: 503,
      async json() { throw Error('secret raw error content') },
    })),
    (error) => {
      assert.match(error.message, /HTTP 503/)
      assert.ok(!error.message.includes('secret raw error content'))
      return true
    },
  )
})
