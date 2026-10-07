import type { CatalogCategory, CatalogFolder, CatalogFranchise, CatalogImage, CatalogModel } from '../types/catalog'
import { FRANCHISE_SEARCH_MIN_LENGTH, type CatalogListQuery, type CatalogModelCard, type CursorPage, type GalleryQuery } from './catalogRepository'

export type CatalogRuntimeMode = 'demo' | 'live'

export type ApiCatalogRow = {
  id: string
  slug: string
  code: string
  name: string
  franchise: string
  franchise_slug: string
  category: string
  category_slug: string
  collection: string | null
  folder_path: string | null
  image_count: number
  gallery_version: number
  cover_storage_key: string | null
}

export type ApiModelRow = ApiCatalogRow & {
  material: string | null
  height_cm: number | null
  description: string | null
  search_text?: string
}

export type ApiGalleryImage = {
  id: string
  role: 'cover' | 'gallery'
  width: number
  height: number
  bytes: number
  mime: string
  qualityScore: number
  sourceSha256: string
  variantKeys: {
    thumb?: string
    card?: string
    detail?: string
    original?: string
  }
}

export type GalleryPage = {
  items: ApiGalleryImage[]
  nextCursor: string | null
  total: number
  version: number
}

export type FranchiseDiscoveryPage = {
  items: CatalogFranchise[]
  truncated: boolean
}

export type FolderDiscoveryPage = {
  current: Pick<CatalogFolder, 'id' | 'label' | 'count'> | null
  trail: Array<Pick<CatalogFolder, 'id' | 'label'>>
  items: CatalogFolder[]
}

type GalleryCacheEntry = {
  expiresAt: number
  promise: Promise<GalleryPage>
}

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
const mediaBase = (import.meta.env.VITE_MEDIA_BASE_URL as string | undefined)?.replace(/\/$/, '')

function resolveApiBase() {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLocaleLowerCase('en-US')
    if (hostname === 'acheguese.com.br' || hostname === 'www.acheguese.com.br') {
      return `${window.location.origin}/catalogo-api`
    }
  }
  return configuredApiBase
}

const apiBase = resolveApiBase()
const GALLERY_PAGE_CACHE_LIMIT = 40
const GALLERY_PAGE_CACHE_TTL_MS = 5 * 60 * 1000
const galleryPageCache = new Map<string, GalleryCacheEntry>()

export function getCatalogRuntimeMode(): CatalogRuntimeMode {
  return apiBase ? 'live' : 'demo'
}

function endpoint(path: string, params?: Record<string, string | number | undefined>) {
  if (!apiBase) throw new Error('catalog_api_not_configured')
  const url = new URL(`${apiBase}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `catalog_request_failed_${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function checkCatalogApi() {
  if (!apiBase) return { mode: 'demo' as const, ok: true }
  try {
    const result = await requestJson<{ ok: boolean }>(endpoint('/api/health'))
    return { mode: 'live' as const, ok: result.ok }
  } catch {
    return { mode: 'live' as const, ok: false }
  }
}

export async function listCatalogCategories(): Promise<CatalogCategory[]> {
  const result = await requestJson<{ items: Array<Omit<CatalogCategory, 'coverUrl'> & { cover_storage_key?: string | null }> }>(endpoint('/api/categories'))
  return result.items.map(({ cover_storage_key, ...item }) => ({
    ...item,
    coverUrl: mediaObjectUrl(cover_storage_key),
  }))
}

export async function listCatalogFranchises(category?: string, limit = 24, search?: string): Promise<FranchiseDiscoveryPage> {
  const page = await requestJson<{ items: Array<Omit<CatalogFranchise, 'coverUrl'> & { cover_storage_key?: string | null }>; truncated: boolean }>(endpoint('/api/franchises', {
    category: category && category !== 'all' ? category : undefined,
    limit,
    q: search && Array.from(search.trim()).length >= FRANCHISE_SEARCH_MIN_LENGTH ? search.trim() : undefined,
  }))
  return {
    truncated: page.truncated,
    items: page.items.map(({ cover_storage_key, ...item }) => ({
      ...item,
      coverUrl: mediaObjectUrl(cover_storage_key),
    })),
  }
}

export async function listCatalogFolders(category: string, franchise: string, parent?: string): Promise<FolderDiscoveryPage> {
  const page = await requestJson<Partial<FolderDiscoveryPage>>(endpoint('/api/folders', {
    category,
    franchise,
    parent: parent?.trim() || undefined,
  }))
  return {
    current: page.current ?? null,
    trail: Array.isArray(page.trail) ? page.trail : [],
    items: Array.isArray(page.items) ? page.items : [],
  }
}

function mediaObjectUrl(key: string | null | undefined) {
  if (!key || !mediaBase) return undefined
  return `${mediaBase}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function liveSearchTerm(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed || Array.from(trimmed).length < 3) return undefined
  return trimmed
}

const LEGACY_VIEW_SUFFIXES: Array<{ suffix: string; priority: number }> = [
  { suffix: '-frente-alternativo', priority: 30 },
  { suffix: '-frente-alternativa', priority: 30 },
  { suffix: '-costas-corpo-inteiro', priority: 31 },
  { suffix: '-costas-close', priority: 32 },
  { suffix: '-vista-frontal', priority: 2 },
  { suffix: '-vista-lateral', priority: 11 },
  { suffix: '-vista-traseira', priority: 22 },
  { suffix: '-corpo-inteiro', priority: 3 },
  { suffix: '-em-pe', priority: 4 },
  { suffix: '-frente', priority: 0 },
  { suffix: '-frontal', priority: 1 },
  { suffix: '-lateral', priority: 10 },
  { suffix: '-perfil', priority: 12 },
  { suffix: '-costas', priority: 20 },
  { suffix: '-traseira', priority: 21 },
  { suffix: '-traseiro', priority: 21 },
  { suffix: '-close', priority: 40 },
]

function legacyViewDescriptor(slug: string) {
  for (const entry of LEGACY_VIEW_SUFFIXES) {
    if (!slug.endsWith(entry.suffix)) continue
    const family = slug.slice(0, -entry.suffix.length)
    if (family) return { family, priority: entry.priority }
  }
  return null
}

export function collapseLegacyViewRows(rows: ApiCatalogRow[]): CatalogModelCard[] {
  const groups = new Map<string, Array<{ row: ApiCatalogRow; priority: number; index: number }>>()

  rows.forEach((row, index) => {
    if (row.image_count !== 1) return
    const descriptor = legacyViewDescriptor(row.slug)
    if (!descriptor) return
    const key = [
      row.category_slug,
      row.franchise_slug,
      row.folder_path ?? '',
      row.name,
      descriptor.family,
    ].join('|')
    const members = groups.get(key) ?? []
    members.push({ row, priority: descriptor.priority, index })
    groups.set(key, members)
  })

  const membership = new Map<string, string>()
  for (const [key, members] of groups) {
    if (members.length < 2) continue
    for (const member of members) membership.set(member.row.id, key)
  }

  const emitted = new Set<string>()
  const cards: CatalogModelCard[] = []
  rows.forEach((row) => {
    const key = membership.get(row.id)
    if (!key) {
      cards.push(toCatalogModelCard(row))
      return
    }
    if (emitted.has(key)) return
    emitted.add(key)

    const members = [...(groups.get(key) ?? [])].sort(
      (left, right) => left.priority - right.priority
        || left.row.slug.localeCompare(right.row.slug, 'pt-BR'),
    )
    const canonical = members[0].row
    const card = toCatalogModelCard(canonical)
    card.galleryCount = members.reduce((sum, member) => sum + member.row.image_count, 0)
    card.galleryVersion = members.reduce((sum, member) => sum + member.row.gallery_version, 0)
    card.gallerySourceSlugs = members.map((member) => member.row.slug)
    cards.push(card)
  })

  return cards
}

function toCatalogModelCard(row: ApiCatalogRow): CatalogModelCard {
  return {
    id: row.id,
    slug: row.slug,
    code: row.code,
    name: row.name,
    franchise: row.franchise,
    franchiseSlug: row.franchise_slug,
    category: row.category_slug,
    collection: row.collection ?? '',
    folderPath: row.folder_path ?? '',
    galleryCount: row.image_count,
    galleryVersion: row.gallery_version,
    accent: '#c98a3d',
    coverUrl: mediaObjectUrl(row.cover_storage_key),
  }
}

export async function listCatalogModels(query: CatalogListQuery = {}): Promise<CursorPage<CatalogModelCard>> {
  const result = await requestJson<{ items: ApiCatalogRow[]; nextCursor: string | null }>(endpoint('/api/catalog', {
    category: query.category && query.category !== 'all' ? query.category : undefined,
    franchise: query.franchise && query.franchise !== 'all' ? query.franchise : undefined,
    folder: query.folder?.trim() || undefined,
    q: liveSearchTerm(query.search),
    cursor: query.cursor,
    limit: query.limit,
  }))

  return {
    items: collapseLegacyViewRows(result.items),
    nextCursor: result.nextCursor,
    totalApprox: 0,
  }
}

export async function listRecentCatalogModels(limit = 12): Promise<CatalogModelCard[]> {
  const result = await requestJson<{ items: ApiCatalogRow[] }>(endpoint('/api/recent', {
    limit: Math.max(1, Math.min(24, Math.trunc(limit))),
  }))
  return collapseLegacyViewRows(result.items)
}

export async function getCatalogModel(slug: string, galleryVersion?: number): Promise<CatalogModel | null> {
  try {
    const row = await requestJson<ApiModelRow>(endpoint(`/api/models/${encodeURIComponent(slug)}`, {
      v: galleryVersion,
    }))
    return {
      id: row.id,
      slug: row.slug,
      code: row.code,
      name: row.name,
      franchise: row.franchise,
      franchiseSlug: row.franchise_slug,
      category: row.category_slug,
      collection: row.collection ?? '',
      folderPath: row.folder_path ?? '',
      material: row.material ?? '',
      heightCm: row.height_cm ?? 0,
      galleryCount: row.image_count,
      galleryVersion: row.gallery_version,
      description: row.description ?? '',
      tags: [],
      accent: '#c98a3d',
      coverUrl: mediaObjectUrl(row.cover_storage_key),
      images: [],
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'model_not_found') return null
    throw error
  }
}

function galleryCacheKey(slug: string, query: GalleryQuery) {
  return `${slug}|v:${query.version ?? 'unknown'}|page:${query.page ?? 'cursor'}|cursor:${query.cursor ?? 'first'}|limit:${query.limit ?? 24}`
}

function directGalleryCursor(query: GalleryQuery) {
  if (query.cursor) return query.cursor
  if (query.page === undefined) return undefined
  const limit = query.limit ?? 24
  const page = Math.max(0, Math.trunc(query.page))
  return btoa(String(page * limit))
}

function rememberGalleryPage(key: string, promise: Promise<GalleryPage>) {
  if (!galleryPageCache.has(key) && galleryPageCache.size >= GALLERY_PAGE_CACHE_LIMIT) {
    const oldest = galleryPageCache.keys().next().value
    if (oldest) galleryPageCache.delete(oldest)
  }
  galleryPageCache.set(key, { expiresAt: Date.now() + GALLERY_PAGE_CACHE_TTL_MS, promise })
  return promise
}

function loadGalleryPage(slug: string, query: GalleryQuery): Promise<GalleryPage> {
  const key = galleryCacheKey(slug, query)
  const cached = galleryPageCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.promise
  if (cached) galleryPageCache.delete(key)

  const pending = requestJson<GalleryPage>(endpoint(`/api/models/${encodeURIComponent(slug)}/images`, {
    cursor: directGalleryCursor(query),
    limit: query.limit,
    v: query.version,
  })).catch((error) => {
    galleryPageCache.delete(key)
    throw error
  })

  return rememberGalleryPage(key, pending)
}

export async function listCatalogImages(slug: string, query: GalleryQuery = {}): Promise<GalleryPage> {
  const page = await loadGalleryPage(slug, query)

  // Antecipamos apenas o JSON da página seguinte. As imagens continuam lazy e só
  // são baixadas quando a página entra na interface.
  if (page.nextCursor) {
    const nextQuery: GalleryQuery = query.page !== undefined
      ? { page: query.page + 1, limit: query.limit, version: query.version }
      : { cursor: page.nextCursor, limit: query.limit, version: query.version }
    const nextKey = galleryCacheKey(slug, nextQuery)
    const cached = galleryPageCache.get(nextKey)
    if (!cached || cached.expiresAt <= Date.now()) {
      void loadGalleryPage(slug, nextQuery).catch(() => undefined)
    }
  }

  return page
}

export function imageVariantUrl(image: ApiGalleryImage, variant: keyof ApiGalleryImage['variantKeys'] = 'detail') {
  const key = image.variantKeys[variant]
    ?? image.variantKeys.card
    ?? image.variantKeys.thumb
    ?? image.variantKeys.detail
    ?? image.variantKeys.original
  return mediaObjectUrl(key)
}

export function toCatalogImage(image: ApiGalleryImage): CatalogImage {
  return {
    id: image.id,
    url: imageVariantUrl(image, 'card'),
    detailUrl: imageVariantUrl(image, 'detail'),
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    role: image.role,
    qualityScore: image.qualityScore,
  }
}
