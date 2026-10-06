#!/usr/bin/env node

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

export function validateCatalogProbe(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items) || payload.items.length < 1) {
    throw new Error('catalog probe did not return a published model')
  }
  const row = payload.items[0]
  if (!row || typeof row !== 'object') throw new Error('catalog probe returned an invalid model')
  if (typeof row.slug !== 'string' || !row.slug) throw new Error('catalog probe model has no slug')
  if (!positiveInteger(row.image_count)) throw new Error('catalog probe model has invalid image_count')
  if (!positiveInteger(row.gallery_version)) throw new Error('catalog probe model has invalid gallery_version')
  return {
    id: String(row.id ?? ''),
    slug: row.slug,
    imageCount: row.image_count,
    galleryVersion: row.gallery_version,
  }
}

export function validateGalleryProbe(payload, expected) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    throw new Error('gallery probe returned an invalid payload')
  }
  if (!Number.isInteger(payload.total) || payload.total !== expected.imageCount) {
    throw new Error(`gallery total ${payload.total} does not match image_count ${expected.imageCount}`)
  }
  if (!Number.isInteger(payload.version) || payload.version !== expected.galleryVersion) {
    throw new Error(`gallery version ${payload.version} does not match gallery_version ${expected.galleryVersion}`)
  }
  if (payload.items.length < 1) throw new Error('gallery probe returned no images')
  const first = payload.items[0]
  if (!first || typeof first !== 'object' || typeof first.id !== 'string' || !first.id) {
    throw new Error('gallery probe returned an invalid first image')
  }
  if (first.role !== 'cover') throw new Error('gallery first image is not the cover')
  return {
    total: payload.total,
    version: payload.version,
    firstImageId: first.id,
  }
}

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'tonecos-catalog-gallery-smoke/1',
    },
  })
  if (!response?.ok) {
    throw new Error(`${label} failed with HTTP ${response?.status ?? 'unknown'}`)
  }
  return response.json()
}

export async function verifyWorkerGalleryContract(apiBase, fetchImpl = fetch) {
  const base = String(apiBase ?? '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('API base must be http(s)')

  const catalogPayload = await fetchJson(fetchImpl, `${base}/api/catalog?limit=1`, 'catalog probe')
  const model = validateCatalogProbe(catalogPayload)

  const galleryUrl = new URL(`${base}/api/models/${encodeURIComponent(model.slug)}/images`)
  galleryUrl.searchParams.set('limit', '1')
  galleryUrl.searchParams.set('v', String(model.galleryVersion))
  const galleryPayload = await fetchJson(fetchImpl, galleryUrl.toString(), 'gallery probe')
  const gallery = validateGalleryProbe(galleryPayload, model)

  return {
    ok: true,
    modelId: model.id,
    slug: model.slug,
    imageCount: model.imageCount,
    galleryVersion: model.galleryVersion,
    galleryTotal: gallery.total,
    firstImageId: gallery.firstImageId,
  }
}

async function main() {
  const apiBase = process.argv[2] || process.env.CATALOG_API_URL || process.env.VITE_API_BASE_URL
  if (!apiBase) throw new Error('API base is required as argv[2], CATALOG_API_URL or VITE_API_BASE_URL')
  const result = await verifyWorkerGalleryContract(apiBase)
  process.stdout.write(JSON.stringify(result) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}
