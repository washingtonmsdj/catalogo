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
