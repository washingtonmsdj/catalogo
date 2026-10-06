import assert from 'node:assert/strict'
import test from 'node:test'

import {
  galleryGridColumnCount,
  nextGalleryGridIndex,
} from '../src/lib/galleryGridNavigation.ts'

test('detects responsive gallery column count from computed grid value', () => {
  assert.equal(galleryGridColumnCount('220px 220px 220px 220px'), 4)
  assert.equal(galleryGridColumnCount('178px 178px'), 2)
  assert.equal(galleryGridColumnCount(''), 1)
})

test('moves horizontally without leaving gallery bounds', () => {
  assert.equal(nextGalleryGridIndex(0, 12, 4, 'left'), 0)
  assert.equal(nextGalleryGridIndex(0, 12, 4, 'right'), 1)
  assert.equal(nextGalleryGridIndex(11, 12, 4, 'right'), 11)
})

test('moves vertically using current responsive column count', () => {
  assert.equal(nextGalleryGridIndex(5, 12, 4, 'up'), 1)
  assert.equal(nextGalleryGridIndex(5, 12, 4, 'down'), 9)
  assert.equal(nextGalleryGridIndex(3, 12, 2, 'down'), 5)
})

test('clamps incomplete last rows', () => {
  assert.equal(nextGalleryGridIndex(7, 10, 4, 'down'), 9)
  assert.equal(nextGalleryGridIndex(1, 10, 4, 'up'), 0)
})
