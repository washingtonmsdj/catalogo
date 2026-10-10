import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyPromotedWorkerVersion } from './check_promoted_worker_version.mjs'

const OLD_VERSION = '11111111-2222-4333-8444-555555555555'
const NEW_VERSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function healthyRelease() {
  return {
    ok: true,
    health: {
      ok: true,
      service: 'tonecos-catalogo',
      contractVersion: 3,
      latestMigration: '0019_model_variant_name.sql',
      appliedMigrations: 19,
      verifiedStructures: 30,
    },
    categories: 7,
    recent: 1,
    gallery: {
      ok: true,
      modelId: 'mdl_test',
      slug: 'test-model',
      imageCount: 1,
      galleryVersion: 1,
      galleryTotal: 1,
      firstImageId: 'img_test',
    },
    sharedCollections: true,
  }
}

test('waits for control plane and full public release convergence without repeating mutations', async () => {
  const active = [OLD_VERSION, NEW_VERSION]
  let activeCalls = 0
  let releaseCalls = 0
  const sleeps = []

  const result = await verifyPromotedWorkerVersion({
    apiBase: 'https://api.example.test',
    versionId: NEW_VERSION,
    fetchActiveVersion: async () => active[Math.min(activeCalls++, active.length - 1)],
    verifyRelease: async () => {
      releaseCalls += 1
      if (releaseCalls === 1) throw new Error('health payload has no schema status')
      if (releaseCalls === 2) throw new Error('catalog probe model has invalid gallery_version')
      return healthyRelease()
    },
    sleepImpl: async (delay) => sleeps.push(delay),
    controlAttempts: 3,
    controlDelayMs: 11,
    releaseAttempts: 4,
    releaseDelayMs: 17,
  })

  assert.equal(result.ok, true)
  assert.equal(result.versionId, NEW_VERSION)
  assert.equal(result.activeVersion, NEW_VERSION)
  assert.equal(result.health.latestMigration, '0019_model_variant_name.sql')
  assert.equal(result.gallery.galleryVersion, 1)
  assert.equal(activeCalls, 2)
  assert.equal(releaseCalls, 3)
  assert.deepEqual(sleeps, [11, 17, 17])
})

test('fails closed if control plane never reaches promoted version', async () => {
  let releaseCalls = 0
  await assert.rejects(
    () => verifyPromotedWorkerVersion({
      apiBase: 'https://api.example.test',
      versionId: NEW_VERSION,
      fetchActiveVersion: async () => OLD_VERSION,
      verifyRelease: async () => {
        releaseCalls += 1
        return healthyRelease()
      },
      sleepImpl: async () => {},
      controlAttempts: 2,
      controlDelayMs: 0,
    }),
    /active deployment is .* expected/,
  )
  assert.equal(releaseCalls, 0)
})

test('fails closed if any public release contract does not converge after promotion', async () => {
  let releaseCalls = 0
  await assert.rejects(
    () => verifyPromotedWorkerVersion({
      apiBase: 'https://api.example.test',
      versionId: NEW_VERSION,
      fetchActiveVersion: async () => NEW_VERSION,
      verifyRelease: async () => {
        releaseCalls += 1
        throw new Error('catalog probe model has invalid gallery_version')
      },
      sleepImpl: async () => {},
      controlAttempts: 1,
      releaseAttempts: 3,
      releaseDelayMs: 0,
    }),
    /catalog probe model has invalid gallery_version/,
  )
  assert.equal(releaseCalls, 3)
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
