import type { CatalogCategory, CatalogFranchise, CatalogImage, CatalogModel } from '../types/catalog'

export const DEFAULT_PAGE_SIZE = 24
export const MAX_PAGE_SIZE = 60

export type CursorPage<T> = {
  items: T[]
  nextCursor: string | null
  totalApprox: number
}

export type CatalogModelCard = Pick<
  CatalogModel,
  'id' | 'slug' | 'code' | 'name' | 'franchise' | 'category' | 'collection' | 'galleryCount' | 'accent'
> & {
  franchiseSlug?: string
  coverUrl?: string
}

export type CatalogListQuery = {
  category?: string
  franchise?: string
  search?: string
  cursor?: string
  limit?: number
}

export type GalleryQuery = {
  cursor?: string
  limit?: number
}

export interface CatalogRepository {
  listCategories(): Promise<CatalogCategory[]>
  listFranchises(category?: string): Promise<CatalogFranchise[]>
  listModels(query: CatalogListQuery): Promise<CursorPage<CatalogModelCard>>
  getModel(slug: string): Promise<CatalogModel | null>
  listModelImages(slug: string, query?: GalleryQuery): Promise<CursorPage<CatalogImage>>
}

export function normalizePageSize(limit = DEFAULT_PAGE_SIZE) {
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)))
}
