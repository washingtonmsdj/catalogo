import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyPromotedWorkerVersion } from './check_promoted_worker_version.mjs'

const OLD_VERSION = '11111111-2222-4333-8444-555555555555'
const NEW_VERSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function healthyResult() {
  return {
    ok: true,
    service: 'tonecos-catalogo',
    contractVersion: 3,
    latestMigration: '0019_model_variant_name.sql',
    appliedMigrations: 19,
    verifiedStructures: 30,
  }
}

test('waits for control plane and public health convergence without repeating mutations', async () => {
  const active = [OLD_VERSION, NEW_VERSION]
  let activeCalls = 0
  let healthCalls = 0
  const sleeps = []

  const result = await verifyPromotedWorkerVersion({
    apiBase: 'https://api.example.test',
    versionId: NEW_VERSION,
    fetchActiveVersion: async () => active[Math.min(activeCalls++, active.length - 1)],
    verifyHealth: async () => {
      healthCalls += 1
      if (healthCalls < 3) throw new Error('edge still serves previous health contract')
      return healthyResult()
    },
    sleepImpl: async (delay) => sleeps.push(delay),
    controlAttempts: 3,
    controlDelayMs: 11,
    healthAttempts: 4,
    healthDelayMs: 17,
  })

  assert.equal(result.ok, true)
  assert.equal(result.versionId, NEW_VERSION)
  assert.equal(result.activeVersion, NEW_VERSION)
  assert.equal(result.health.latestMigration, '0019_model_variant_name.sql')
  assert.equal(activeCalls, 2)
  assert.equal(healthCalls, 3)
  assert.deepEqual(sleeps, [11, 17, 17])
})

test('fails closed if control plane never reaches promoted version', async () => {
  let healthCalls = 0
  await assert.rejects(
    () => verifyPromotedWorkerVersion({
      apiBase: 'https://api.example.test',
      versionId: NEW_VERSION,
      fetchActiveVersion: async () => OLD_VERSION,
      verifyHealth: async () => {
        healthCalls += 1
        return healthyResult()
      },
      sleepImpl: async () => {},
      controlAttempts: 2,
      controlDelayMs: 0,
    }),
    /active deployment is .* expected/,
  )
  assert.equal(healthCalls, 0)
})

test('fails closed if public health does not converge after promotion', async () => {
  let healthCalls = 0
  await assert.rejects(
    () => verifyPromotedWorkerVersion({
      apiBase: 'https://api.example.test',
      versionId: NEW_VERSION,
      fetchActiveVersion: async () => NEW_VERSION,
      verifyHealth: async () => {
        healthCalls += 1
        throw new Error('health payload has no schema status')
      },
      sleepImpl: async () => {},
      controlAttempts: 1,
      healthAttempts: 3,
      healthDelayMs: 0,
    }),
    /health payload has no schema status/,
  )
  assert.equal(healthCalls, 3)
})

test('rejects invalid API base and version identifiers before polling', async () => {
  await assert.rejects(
    () => verifyPromotedWorkerVersion({ apiBase: 'not-a-url', versionId: NEW_VERSION }),
    /API base must be http\(s\)/,
  )
  await assert.rejects(
    () => verifyPromotedWorkerVersion({ apiBase: 'https://api.example.test', versionId: 'latest' }),
    /canonical UUID/,
  )
})
