import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const worker = fs.readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')
const aggregation = fs.readFileSync(new URL('../worker/galleryAggregation.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(
  new URL('../migrations/0016_public_gallery_revision.sql', import.meta.url),
  'utf8',
)

test('catalog and model responses use public gallery revision', () => {
  assert.match(worker, /const PUBLIC_GALLERY_VERSION_SQL = 'm\.public_gallery_version'/)
  assert.equal(worker.includes('SUM(source.gallery_version)'), false)
  assert.ok((worker.match(/PUBLIC_GALLERY_VERSION_SQL/g) ?? []).length >= 4)
})

test('gallery endpoint returns public revision while source validation keeps physical version', () => {
  assert.match(worker, /m\.public_gallery_version/)
  assert.match(worker, /version: model\.public_gallery_version/)
  assert.match(worker, /source\.gallery_version/)
})

test('aggregation no longer invents a version by summing sources', () => {
  assert.equal(aggregation.includes('logicalGalleryVersion'), false)
  assert.equal(aggregation.includes('version: logicalGalleryVersion'), false)
  assert.match(aggregation, /logicalGalleryImageCount/)
})

test('database revision changes for composition, order and source gallery changes', () => {
  for (const trigger of [
    'trg_public_gallery_revision_after_model_gallery_update',
    'trg_public_gallery_revision_after_member_insert',
    'trg_public_gallery_revision_after_member_delete',
    'trg_public_gallery_revision_after_member_reorder',
  ]) {
    assert.match(migration, new RegExp(trigger))
  }
  assert.match(migration, /public_gallery_version = public_gallery_version \+ 1/)
  assert.match(migration, /source_model_id = NEW\.id/)
})
