import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregateGallerySources,
  logicalGalleryImageCount,
} from '../worker/galleryAggregation.ts'

function source(id, version, imageCount, position) {
  return {
    id,
    image_count: imageCount,
    gallery_manifest_key: `gallery/${id}/manifest.json`,
    gallery_version: version,
    cover_storage_key: `media/${id}/img-1/card.webp`,
    position,
  }
}

function image(modelId, id, role, sha) {
  return {
    id,
    role,
    width: 900,
    height: 1400,
    bytes: 123456,
    mime: 'image/webp',
    qualityScore: 88,
    sourceSha256: sha,
    variantKeys: {
      thumb: `media/${modelId}/${id}/thumb.webp`,
      card: `media/${modelId}/${id}/card.webp`,
      detail: `media/${modelId}/${id}/detail.webp`,
    },
  }
}

function payload(modelId, version, position, shas) {
  const src = source(modelId, version, shas.length, position)
  const images = shas.map((sha, index) =>
    image(modelId, `img-${index + 1}`, index === 0 ? 'cover' : 'gallery', sha),
  )
  return {
    source: src,
    manifest: {
      version,
      modelId,
      images,
    },
  }
}

test('single source keeps the original image identity', () => {
  const result = aggregateGallerySources([
    payload('mdl-a', 10, 0, ['a'.repeat(64), 'b'.repeat(64)]),
  ])

  assert.equal(result.total, 2)
  assert.deepEqual(result.images.map((entry) => entry.id), ['img-1', 'img-2'])
  assert.deepEqual(result.images.map((entry) => entry.role), ['cover', 'gallery'])
})

test('multiple legacy sources become one gallery with one cover', () => {
  const result = aggregateGallerySources([
    payload('mdl-front', 10, 0, ['a'.repeat(64)]),
    payload('mdl-side', 20, 2, ['b'.repeat(64)]),
    payload('mdl-back', 30, 3, ['c'.repeat(64)]),
  ])

  assert.equal(result.total, 3)
  assert.deepEqual(
    result.images.map((entry) => entry.id),
    ['mdl-front:img-1', 'mdl-side:img-1', 'mdl-back:img-1'],
  )
  assert.deepEqual(result.images.map((entry) => entry.role), ['cover', 'gallery', 'gallery'])
  assert.equal(result.images[1].variantKeys.card, 'media/mdl-side/img-1/card.webp')
})

test('rejects exact image repeated across different gallery sources', () => {
  assert.throws(
    () => aggregateGallerySources([
      payload('mdl-front', 10, 0, ['a'.repeat(64)]),
      payload('mdl-side', 20, 1, ['a'.repeat(64)]),
    ]),
    /gallery_duplicate_source_sha/,
  )
})

test('logical image count is the exact sum of source gallery state', () => {
  const sources = [
    source('mdl-a', 11, 4, 0),
    source('mdl-b', 17, 2, 1),
  ]

  assert.equal(logicalGalleryImageCount(sources), 6)
})

test('invalid source manifest fails closed', () => {
  const candidate = payload('mdl-a', 10, 0, ['a'.repeat(64)])
  candidate.manifest.modelId = 'mdl-other'

  assert.throws(
    () => aggregateGallerySources([candidate]),
    /gallery_source_invalid:mdl-a/,
  )
})
