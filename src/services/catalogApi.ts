import type { CatalogCategory, CatalogFolder, CatalogFranchise, CatalogImage, CatalogModel } from '../types/catalog'
import type { CatalogListQuery, CatalogModelCard, CursorPage, GalleryQuery } from './catalogRepository'

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

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
const mediaBase = (import.meta.env.VITE_MEDIA_BASE_URL as string | undefined)?.replace(/\/$/, '')
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
  const result = await requestJson<{ items: CatalogCategory[] }>(endpoint('/api/categories'))
  return result.items
}

export async function listCatalogFranchises(category?: string, limit = 24, search?: string): Promise<FranchiseDiscoveryPage> {
  return requestJson<FranchiseDiscoveryPage>(endpoint('/api/franchises', {
    category: category && category !== 'all' ? category : undefined,
    limit,
    q: search?.trim() || undefined,
  }))
}

export async function listCatalogFolders(category: string, franchise: string, parent?: string): Promise<FolderDiscoveryPage> {
  return requestJson<FolderDiscoveryPage>(endpoint('/api/folders', {
    category,
    franchise,
    parent: parent?.trim() || undefined,
  }))
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
    items: result.items.map((row) => ({
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
      accent: '#c98a3d',
      coverUrl: mediaObjectUrl(row.cover_storage_key),
    })),
    nextCursor: result.nextCursor,
    totalApprox: 0,
  }
}

export async function getCatalogModel(slug: string): Promise<CatalogModel | null> {
  try {
    const row = await requestJson<ApiModelRow>(endpoint(`/api/models/${encodeURIComponent(slug)}`))
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
      material: row.material ?? 'Sob consulta',
      heightCm: row.height_cm ?? 0,
      galleryCount: row.image_count,
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
  return `${slug}|page:${query.page ?? 'cursor'}|cursor:${query.cursor ?? 'first'}|limit:${query.limit ?? 24}`
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
      ? { page: query.page + 1, limit: query.limit }
      : { cursor: page.nextCursor, limit: query.limit }
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
