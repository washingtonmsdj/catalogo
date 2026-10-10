import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { verifyWorkerReleaseContract } from './worker_release_smoke.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog-schema-contract.json'), 'utf8'))

function requiredStructureCount() {
  const objects = schema.requiredObjects
  return (
    objects.tables.length +
    objects.indexes.length +
    objects.triggers.length +
    Object.values(objects.columns).reduce((sum, values) => sum + values.length, 0)
  )
}

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
  }
}

function healthyHealth() {
  const structures = requiredStructureCount()
  return {
    ok: true,
    service: 'tonecos-catalogo',
    schema: {
      ready: true,
      contractVersion: schema.version,
      latestMigration: schema.latestMigration,
      requiredMigrations: schema.requiredMigrations.length,
      appliedMigrations: schema.requiredMigrations.length,
      missingMigrations: [],
      requiredStructures: structures,
      verifiedStructures: structures,
      missingStructures: [],
    },
  }
}

function createReleaseFetch({ staleGallery = false } = {}) {
  const calls = []
  const fetchImpl = async (input) => {
    const url = new URL(String(input))
    calls.push(`${url.pathname}${url.search}`)

    if (url.pathname === '/api/health') return jsonResponse(healthyHealth())
    if (url.pathname === '/api/categories') return jsonResponse({ items: [{ id: 1, name: 'Animes' }] })
    if (url.pathname === '/api/recent') {
      return jsonResponse({ items: [{ id: 'mdl_test', slug: 'test-model' }] })
    }
    if (url.pathname === '/api/catalog') {
      return jsonResponse({
        items: [{
          id: 'mdl_test',
          slug: 'test-model',
          image_count: 1,
          ...(staleGallery ? {} : { gallery_version: 1 }),
        }],
      })
    }
    if (url.pathname === '/api/models/test-model/images') {
      return jsonResponse({
        total: 1,
        version: 1,
        items: [{ id: 'img_test', role: 'cover' }],
      })
    }
    if (url.pathname === '/api/shared-collections/TCL-AAAAAAAAAAAAAAAA') {
      return jsonResponse({ error: 'shared_collection_not_found' }, { status: 404 })
    }
    throw new Error(`unexpected release-smoke URL: ${url}`)
  }
  return { fetchImpl, calls }
}

test('canonical release smoke validates every public contract as one unit', async () => {
  const { fetchImpl, calls } = createReleaseFetch()
  const result = await verifyWorkerReleaseContract('https://api.example.test/', fetchImpl)

  assert.equal(result.ok, true)
  assert.equal(result.health.latestMigration, schema.latestMigration)
  assert.equal(result.categories, 1)
  assert.equal(result.recent, 1)
  assert.equal(result.gallery.galleryVersion, 1)
  assert.equal(result.sharedCollections, true)
  assert.deepEqual(calls, [
    '/api/health',
    '/api/categories',
    '/api/recent?limit=1',
    '/api/catalog?limit=1',
    '/api/models/test-model/images?limit=1&v=1',
    '/api/shared-collections/TCL-AAAAAAAAAAAAAAAA',
  ])
})

test('release smoke fails if one route still exposes the previous gallery contract', async () => {
  const { fetchImpl, calls } = createReleaseFetch({ staleGallery: true })
  await assert.rejects(
    () => verifyWorkerReleaseContract('https://api.example.test', fetchImpl),
    /catalog probe model has invalid gallery_version/,
  )
  assert.deepEqual(calls, [
    '/api/health',
    '/api/categories',
    '/api/recent?limit=1',
    '/api/catalog?limit=1',
  ])
})

test('release smoke rejects an invalid public API base before any request', async () => {
  let calls = 0
  await assert.rejects(
    () => verifyWorkerReleaseContract('not-a-url', async () => { calls += 1 }),
    /API base must be http\(s\)/,
  )
  assert.equal(calls, 0)
})
