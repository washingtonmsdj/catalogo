import type { CatalogCategory, CatalogFranchise, CatalogImage, CatalogModel } from '../types/catalog'
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

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
const mediaBase = (import.meta.env.VITE_MEDIA_BASE_URL as string | undefined)?.replace(/\/$/, '')

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

export async function listCatalogFranchises(category?: string): Promise<CatalogFranchise[]> {
  const result = await requestJson<{ items: CatalogFranchise[] }>(endpoint('/api/franchises', {
    category: category && category !== 'all' ? category : undefined,
  }))
  return result.items
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

export async function listCatalogImages(slug: string, query: GalleryQuery = {}): Promise<GalleryPage> {
  return requestJson<GalleryPage>(endpoint(`/api/models/${encodeURIComponent(slug)}/images`, {
    cursor: query.cursor,
    limit: query.limit,
  }))
}

export function imageVariantUrl(image: ApiGalleryImage, variant: keyof ApiGalleryImage['variantKeys'] = 'detail') {
  const key = image.variantKeys[variant] ?? image.variantKeys.card ?? image.variantKeys.thumb
  return mediaObjectUrl(key)
}

export function toCatalogImage(image: ApiGalleryImage): CatalogImage {
  return {
    id: image.id,
    url: imageVariantUrl(image),
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    role: image.role,
    qualityScore: image.qualityScore,
  }
}
