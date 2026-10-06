import assert from 'node:assert/strict'
import test from 'node:test'

import { validGalleryManifest } from '../worker/galleryValidation.ts'

const model = {
  id: 'mdl_abc',
  image_count: 2,
  gallery_manifest_key: 'gallery/mdl_abc/manifest.json',
  gallery_version: 123,
}

function image(id, role, sha) {
  return {
    id,
    role,
    width: 1200,
    height: 1800,
    bytes: 123456,
    mime: 'image/webp',
    qualityScore: 91.2,
    sourceSha256: sha,
    variantKeys: {
      thumb: `media/mdl_abc/${id}/thumb.webp`,
      card: `media/mdl_abc/${id}/card.webp`,
      detail: `media/mdl_abc/${id}/detail.webp`,
    },
  }
}

function manifest() {
  return {
    version: 123,
    modelId: 'mdl_abc',
    images: [
      image('img_a', 'cover', 'a'.repeat(64)),
      image('img_b', 'gallery', 'b'.repeat(64)),
    ],
  }
}

test('accepts a coherent multi-image gallery', () => {
  assert.equal(validGalleryManifest(manifest(), model), true)
})

test('rejects manifest version different from D1', () => {
  const candidate = manifest()
  candidate.version = 124
  assert.equal(validGalleryManifest(candidate, model), false)
})

test('rejects image count different from D1', () => {
  const candidate = manifest()
  candidate.images.pop()
  assert.equal(validGalleryManifest(candidate, model), false)
})

test('rejects a media key belonging to another model', () => {
  const candidate = manifest()
  candidate.images[1].variantKeys.detail = 'media/mdl_other/img_b/detail.webp'
  assert.equal(validGalleryManifest(candidate, model), false)
})

test('rejects path traversal and backslash keys', () => {
  const traversal = manifest()
  traversal.images[1].variantKeys.card = 'media/mdl_abc/../secret.webp'
  assert.equal(validGalleryManifest(traversal, model), false)

  const windowsPath = manifest()
  windowsPath.images[1].variantKeys.card = 'media\\mdl_abc\\img_b\\card.webp'
  assert.equal(validGalleryManifest(windowsPath, model), false)
})

test('rejects invalid source SHA-256', () => {
  const candidate = manifest()
  candidate.images[1].sourceSha256 = 'not-a-sha'
  assert.equal(validGalleryManifest(candidate, model), false)
})

test('requires exactly one cover and requires it first', () => {
  const twoCovers = manifest()
  twoCovers.images[1].role = 'cover'
  assert.equal(validGalleryManifest(twoCovers, model), false)

  const coverSecond = manifest()
  coverSecond.images[0].role = 'gallery'
  coverSecond.images[1].role = 'cover'
  assert.equal(validGalleryManifest(coverSecond, model), false)
})

test('rejects duplicate image IDs', () => {
  const candidate = manifest()
  candidate.images[1].id = candidate.images[0].id
  assert.equal(validGalleryManifest(candidate, model), false)
})

test('requires positive model image count', () => {
  assert.equal(validGalleryManifest(manifest(), { ...model, image_count: 0 }), false)
})
