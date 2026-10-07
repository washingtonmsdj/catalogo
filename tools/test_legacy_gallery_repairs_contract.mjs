import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateResolvedGallery,
  validateResolvedModel,
  verifyLegacyGalleryRepairs,
} from './check_legacy_gallery_repairs.mjs'

const groups = [{
  family: 'dragon-ball-androide-18-traje-casual',
  canonicalSlug: 'dragon-ball-androide-18-traje-casual-frente',
  memberSlugs: [
    'dragon-ball-androide-18-traje-casual-frente',
    'dragon-ball-androide-18-traje-casual-lateral',
    'dragon-ball-androide-18-traje-casual-costas',
  ],
}]

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
  }
}

test('validates canonical model and complete logical gallery', () => {
  const expected = {
    canonicalSlug: groups[0].canonicalSlug,
    imageCount: 3,
  }
  const model = validateResolvedModel({
    id: 'mdl-canonical',
    slug: groups[0].canonicalSlug,
    image_count: 3,
    gallery_version: 9,
  }, expected)

  validateResolvedGallery({
    total: 3,
    version: 9,
    items: [
      { id: 'cover', role: 'cover' },
      { id: 'side', role: 'gallery' },
      { id: 'back', role: 'gallery' },
    ],
  }, model)

  assert.equal(model.id, 'mdl-canonical')
  assert.equal(model.galleryVersion, 9)
})

test('rejects duplicate image ids and wrong alias target', () => {
  assert.throws(() => validateResolvedGallery({
    total: 3,
    version: 9,
    items: [
      { id: 'same', role: 'cover' },
      { id: 'same', role: 'gallery' },
      { id: 'back', role: 'gallery' },
    ],
  }, { imageCount: 3, galleryVersion: 9 }), /duplicate image id/)

  assert.throws(() => validateResolvedModel({
    id: 'wrong',
    slug: 'outro-modelo',
    image_count: 3,
    gallery_version: 9,
  }, {
    canonicalSlug: groups[0].canonicalSlug,
    imageCount: 3,
  }), /unexpected slug/)
})

test('all legacy aliases resolve to one canonical public gallery', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    const parsed = new URL(url)
    const isGallery = parsed.pathname.endsWith('/images')
    if (isGallery) {
      return response({
        total: 3,
        version: 12,
        items: [
          { id: 'cover', role: 'cover' },
          { id: 'side', role: 'gallery' },
          { id: 'back', role: 'gallery' },
        ],
      })
    }
    return response({
      id: 'mdl-canonical',
      slug: groups[0].canonicalSlug,
      image_count: 3,
      gallery_version: 12,
    })
  }

  const result = await verifyLegacyGalleryRepairs('https://catalog.example', groups, fetchImpl)

  assert.deepEqual(result, {
    ok: true,
    groups: 1,
    aliases: 2,
    modelChecks: 3,
    galleryChecks: 2,
  })
  assert.equal(calls.length, 5)
  assert.ok(calls.some((url) => url.includes('traje-casual-lateral')))
  assert.ok(calls.some((url) => url.includes('traje-casual-costas')))
})

test('fails if an alias resolves with a different public revision', async () => {
  let modelCalls = 0
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/images')) {
      return response({
        total: 3,
        version: 12,
        items: [
          { id: 'cover', role: 'cover' },
          { id: 'side', role: 'gallery' },
          { id: 'back', role: 'gallery' },
        ],
      })
    }
    modelCalls += 1
    return response({
      id: 'mdl-canonical',
      slug: groups[0].canonicalSlug,
      image_count: 3,
      gallery_version: modelCalls === 1 ? 12 : 13,
    })
  }

  await assert.rejects(
    verifyLegacyGalleryRepairs('https://catalog.example', groups, fetchImpl),
    /diverges from canonical/,
  )
})
