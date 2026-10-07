#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'catalog-legacy-gallery-overrides.json')

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

export function loadRepairGroups(configPath = DEFAULT_CONFIG) {
  const payload = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (!payload || payload.version !== 2 || !Array.isArray(payload.groups) || !payload.groups.length) {
    throw new Error('legacy repair registry is invalid')
  }
  return payload.groups
}

export function validateResolvedModel(payload, expected) {
  if (!payload || typeof payload !== 'object') throw new Error('model payload is invalid')
  if (payload.slug !== expected.canonicalSlug) {
    throw new Error(`alias resolved to unexpected slug: ${payload.slug} != ${expected.canonicalSlug}`)
  }
  if (typeof payload.id !== 'string' || !payload.id) throw new Error('resolved model has no id')
  if (!positiveInteger(payload.image_count) || payload.image_count !== expected.imageCount) {
    throw new Error(`resolved model image_count mismatch: ${payload.image_count} != ${expected.imageCount}`)
  }
  if (!positiveInteger(payload.gallery_version)) {
    throw new Error('resolved model gallery_version is invalid')
  }
  return {
    id: payload.id,
    slug: payload.slug,
    imageCount: payload.image_count,
    galleryVersion: payload.gallery_version,
  }
}

export function validateResolvedGallery(payload, expected) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    throw new Error('gallery payload is invalid')
  }
  if (payload.total !== expected.imageCount) {
    throw new Error(`resolved gallery total mismatch: ${payload.total} != ${expected.imageCount}`)
  }
  if (payload.version !== expected.galleryVersion) {
    throw new Error(`resolved gallery version mismatch: ${payload.version} != ${expected.galleryVersion}`)
  }
  if (payload.items.length !== expected.imageCount) {
    throw new Error(`resolved gallery page is incomplete: ${payload.items.length} != ${expected.imageCount}`)
  }
  const ids = new Set()
  let covers = 0
  for (const [index, image] of payload.items.entries()) {
    if (!image || typeof image !== 'object' || typeof image.id !== 'string' || !image.id) {
      throw new Error('resolved gallery contains invalid image')
    }
    if (ids.has(image.id)) throw new Error(`resolved gallery contains duplicate image id: ${image.id}`)
    ids.add(image.id)
    if (image.role === 'cover') covers += 1
    if (index === 0 && image.role !== 'cover') throw new Error('resolved gallery first image is not cover')
  }
  if (covers !== 1) throw new Error(`resolved gallery must contain exactly one cover: ${covers}`)
}

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'tonecos-catalog-legacy-repair-smoke/1',
    },
  })
  if (!response?.ok) throw new Error(`${label} failed with HTTP ${response?.status ?? 'unknown'}`)
  return response.json()
}

export async function verifyLegacyGalleryRepairs(apiBase, groups, fetchImpl = fetch) {
  const base = String(apiBase ?? '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('API base must be http(s)')
  if (!Array.isArray(groups) || !groups.length) throw new Error('repair groups are required')

  let aliases = 0
  let modelChecks = 0
  let galleryChecks = 0

  for (const group of groups) {
    const canonicalSlug = String(group.canonicalSlug ?? '')
    const memberSlugs = Array.isArray(group.memberSlugs) ? group.memberSlugs.map(String) : []
    if (!canonicalSlug || memberSlugs.length < 2 || !memberSlugs.includes(canonicalSlug)) {
      throw new Error(`invalid repair group: ${group.family ?? canonicalSlug}`)
    }
    const expected = {
      canonicalSlug,
      imageCount: memberSlugs.length,
    }
    const canonicalPayload = await fetchJson(
      fetchImpl,
      `${base}/api/models/${encodeURIComponent(canonicalSlug)}`,
      `canonical model ${canonicalSlug}`,
    )
    const canonical = validateResolvedModel(canonicalPayload, expected)
    modelChecks += 1

    const galleryUrl = new URL(`${base}/api/models/${encodeURIComponent(canonicalSlug)}/images`)
    galleryUrl.searchParams.set('limit', '60')
    galleryUrl.searchParams.set('v', String(canonical.galleryVersion))
    const galleryPayload = await fetchJson(
      fetchImpl,
      galleryUrl.toString(),
      `canonical gallery ${canonicalSlug}`,
    )
    validateResolvedGallery(galleryPayload, canonical)
    galleryChecks += 1

    for (const slug of memberSlugs) {
      if (slug === canonicalSlug) continue
      aliases += 1
      const aliasPayload = await fetchJson(
        fetchImpl,
        `${base}/api/models/${encodeURIComponent(slug)}`,
        `legacy alias ${slug}`,
      )
      const resolved = validateResolvedModel(aliasPayload, expected)
      modelChecks += 1
      if (resolved.id !== canonical.id || resolved.galleryVersion !== canonical.galleryVersion) {
        throw new Error(`legacy alias diverges from canonical: ${slug}`)
      }
    }

    const firstAlias = memberSlugs.find((slug) => slug !== canonicalSlug)
    if (firstAlias) {
      const aliasGalleryUrl = new URL(`${base}/api/models/${encodeURIComponent(firstAlias)}/images`)
      aliasGalleryUrl.searchParams.set('limit', '60')
      aliasGalleryUrl.searchParams.set('v', String(canonical.galleryVersion))
      const aliasGallery = await fetchJson(
        fetchImpl,
        aliasGalleryUrl.toString(),
        `legacy alias gallery ${firstAlias}`,
      )
      validateResolvedGallery(aliasGallery, canonical)
      galleryChecks += 1
    }
  }

  return {
    ok: true,
    groups: groups.length,
    aliases,
    modelChecks,
    galleryChecks,
  }
}

async function main() {
  const apiBase = process.argv[2] || process.env.CATALOG_API_URL || process.env.VITE_API_BASE_URL
  if (!apiBase) throw new Error('API base is required')
  const groups = loadRepairGroups()
  const result = await verifyLegacyGalleryRepairs(apiBase, groups)
  process.stdout.write(JSON.stringify(result) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}
