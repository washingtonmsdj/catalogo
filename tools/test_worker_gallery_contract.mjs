import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateCatalogProbe,
  validateGalleryProbe,
  verifyWorkerGalleryContract,
} from './check_worker_gallery_contract.mjs'

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload
    },
  }
}

test('validates catalog and gallery contract end to end', async () => {
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(String(url))
    if (calls.length === 1) {
      return response({
        items: [{
          id: 'mdl-1',
          slug: 'modelo-um',
          image_count: 3,
          gallery_version: 77,
        }],
      })
    }
    return response({
      items: [{ id: 'img-1', role: 'cover' }],
      total: 3,
      version: 77,
      nextCursor: 'cursor',
    })
  }

  const result = await verifyWorkerGalleryContract('https://api.example.com/', fakeFetch)

  assert.equal(result.ok, true)
  assert.equal(result.imageCount, 3)
  assert.equal(result.galleryVersion, 77)
  assert.match(calls[1], /\/api\/models\/modelo-um\/images/)
  assert.match(calls[1], /[?&]limit=1(?:&|$)/)
  assert.match(calls[1], /[?&]v=77(?:&|$)/)
})

test('catalog probe requires gallery_version', () => {
  assert.throws(
    () => validateCatalogProbe({ items: [{ id: 'mdl-1', slug: 'modelo', image_count: 1 }] }),
    /invalid gallery_version/,
  )
})

test('gallery probe rejects total mismatch', () => {
  assert.throws(
    () => validateGalleryProbe(
      { items: [{ id: 'img-1', role: 'cover' }], total: 2, version: 9 },
      { imageCount: 3, galleryVersion: 9 },
    ),
    /does not match image_count/,
  )
})

test('gallery probe rejects version mismatch', () => {
  assert.throws(
    () => validateGalleryProbe(
      { items: [{ id: 'img-1', role: 'cover' }], total: 1, version: 10 },
      { imageCount: 1, galleryVersion: 9 },
    ),
    /does not match gallery_version/,
  )
})

test('gallery probe requires cover first', () => {
  assert.throws(
    () => validateGalleryProbe(
      { items: [{ id: 'img-1', role: 'gallery' }], total: 1, version: 9 },
      { imageCount: 1, galleryVersion: 9 },
    ),
    /not the cover/,
  )
})

test('HTTP failure fails closed', async () => {
  await assert.rejects(
    () => verifyWorkerGalleryContract(
      'https://api.example.com',
      async () => response({ error: 'boom' }, false, 503),
    ),
    /HTTP 503/,
  )
})
