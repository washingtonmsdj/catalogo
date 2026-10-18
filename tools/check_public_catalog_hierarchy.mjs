#!/usr/bin/env node
/**
 * Read-only production hierarchy smoke. Runs only after canonical Worker health
 * confirms D1 runtime schema. Discovers real records; never seeds or mutates.
 * At most twelve GET requests per run, including the health request.
 */
import { verifyWorkerHealth } from './check_worker_health.mjs'

const CANDIDATE_LIMIT = 5
const MAX_FOLDER_DEPTH = 3

function validatedBase(apiBase) {
  const base = new URL(String(apiBase ?? ''))
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('A clean HTTPS API base is required')
  }
  return base.toString().replace(/\/$/, '')
}

function scoped(base, route, query) {
  const url = new URL(base + route)
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value))
  }
  return url.toString()
}

async function readPublicJson(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'tonecos-catalog-hierarchy-smoke/1' },
    signal: AbortSignal.timeout(10000),
  })
  if (!response?.ok) throw new Error(label + ': HTTP ' + (response?.status ?? 'unknown'))
  const result = await response.json()
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(label + ': invalid JSON object')
  }
  return result
}

function checkFolderItems(payload, parent) {
  if (!Array.isArray(payload.items)) throw new Error('Folders response has no items array')
  if (parent) {
    if (payload.current?.id !== parent) throw new Error('Current folder does not match requested path')
    if (!Array.isArray(payload.trail) || payload.trail.at(-1)?.id !== parent) {
      throw new Error('Folder breadcrumb is inconsistent')
    }
  } else if (payload.current !== null || !Array.isArray(payload.trail) || payload.trail.length) {
    throw new Error('Root folder payload is inconsistent')
  }
  for (const folder of payload.items) {
    if (!folder || typeof folder.id !== 'string' || !folder.id ||
        !Number.isFinite(folder.count) || folder.count < 0 ||
        typeof folder.hasChildren !== 'boolean' ||
        (parent && !folder.id.startsWith(parent + '/'))) {
      throw new Error('Invalid folder path, count, or hierarchy')
    }
  }
  return payload.items
}

function choosePublishedFolder(items) {
  return items.find(item => item.count > 0 && item.hasChildren) ||
    items.find(item => item.count > 0)
}

export async function verifyPublicCatalogHierarchy(apiBase, fetchImpl = fetch) {
  const base = validatedBase(apiBase)
  // Full schema contract, not merely a successful HTTP response.
  const health = await verifyWorkerHealth(base, fetchImpl)

  const categories = await readPublicJson(fetchImpl, scoped(base, '/api/categories'), 'Categories')
  if (!Array.isArray(categories.items)) throw new Error('Categories response has no items array')
  const categoryIds = new Set(categories.items.map(item => item.id))
  const franchises = await readPublicJson(fetchImpl, scoped(base, '/api/franchises', { limit: 24 }), 'Franchises')
  if (!Array.isArray(franchises.items)) throw new Error('Franchises response has no items array')

  const candidates = franchises.items.filter(item =>
    item && typeof item.id === 'string' && item.id &&
    typeof item.category === 'string' && categoryIds.has(item.category) &&
    Number.isFinite(item.count) && item.count > 0
  ).slice(0, CANDIDATE_LIMIT)
  if (!candidates.length) throw new Error('No published franchise with a known category')

  let chosen
  for (const franchise of candidates) {
    const root = await readPublicJson(fetchImpl, scoped(base, '/api/folders', {
      category: franchise.category, franchise: franchise.id,
    }), 'Root folders')
    const candidate = choosePublishedFolder(checkFolderItems(root, ''))
    if (candidate) { chosen = { franchise, folder: candidate }; break }
  }
  if (!chosen) {
    throw new Error('No populated folder found in the first five published franchises; production journey unverified')
  }

  let depth = 1
  while (chosen.folder.hasChildren && depth < MAX_FOLDER_DEPTH) {
    const parent = chosen.folder.id
    const page = await readPublicJson(fetchImpl, scoped(base, '/api/folders', {
      category: chosen.franchise.category, franchise: chosen.franchise.id, parent,
    }), 'Nested folders')
    const nested = choosePublishedFolder(checkFolderItems(page, parent))
    if (!nested) throw new Error('Folder claims descendants but no populated child was returned')
    chosen.folder = nested
    depth += 1
  }

  const listing = await readPublicJson(fetchImpl, scoped(base, '/api/catalog', {
    category: chosen.franchise.category,
    franchise: chosen.franchise.id,
    folder: chosen.folder.id,
    limit: 1,
  }), 'Scoped catalog')
  if (!Array.isArray(listing.items) || !listing.items.length) {
    throw new Error('Populated folder returned no published model')
  }
  const model = listing.items[0]
  const inFolder = value => value === chosen.folder.id ||
    (typeof value === 'string' && value.startsWith(chosen.folder.id + '/'))
  if (!model?.slug || !model.id ||
      model.category_slug !== chosen.franchise.category ||
      model.franchise_slug !== chosen.franchise.id ||
      !inFolder(model.folder_path)) {
    throw new Error('Scoped catalog returned a model outside its requested hierarchy')
  }

  const detail = await readPublicJson(fetchImpl,
    scoped(base, '/api/models/' + encodeURIComponent(model.slug)), 'Model detail')
  if (detail.slug !== model.slug || detail.id !== model.id ||
      detail.category_slug !== model.category_slug ||
      detail.franchise_slug !== model.franchise_slug ||
      !inFolder(detail.folder_path)) {
    throw new Error('Model detail does not match the filtered catalog entry')
  }

  return {
    ok: true,
    health,
    category: chosen.franchise.category,
    franchise: chosen.franchise.id,
    folder: chosen.folder.id,
    depth,
    modelSlug: model.slug,
    readOnly: true,
  }
}

async function main() {
  const base = process.argv[2] || process.env.CATALOG_API_URL
  if (!base) throw new Error('CATALOG_API_URL or argv[2] is required')
  process.stdout.write(JSON.stringify(await verifyPublicCatalogHierarchy(base)) + '\n')
}

if (import.meta.url === 'file://' + process.argv[1]) {
  main().catch(error => {
    console.error('Public hierarchy smoke blocked: ' + (error instanceof Error ? error.message : String(error)))
    process.exitCode = 2
  })
}
