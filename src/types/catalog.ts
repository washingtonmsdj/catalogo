export type ModelRouteStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'error'

export type CatalogCategory = {
  id: string
  label: string
  count: number
  coverUrl?: string
}

export type CatalogFranchise = {
  id: string
  label: string
  count: number
  category: string
  coverUrl?: string
}

export type CatalogFolder = {
  id: string
  label: string
  count: number
  hasChildren: boolean
}

export type CatalogImage = {
  id: string
  /** Variante leve usada na grade/miniatura da galeria. */
  url?: string
  /** Variante de maior resolução, carregada somente ao ampliar a imagem. */
  detailUrl?: string
  width: number
  height: number
  bytes: number
  role: 'cover' | 'gallery'
  qualityScore: number
}

export type CatalogModel = {
  id: string
  slug: string
  code: string
  name: string
  franchise: string
  franchiseSlug?: string
  category: string
  collection: string
  folderPath?: string
  material: string
  heightCm: number
  galleryCount: number
  galleryVersion?: number
  /** Slugs legados que representam apenas vistas adicionais deste mesmo produto. */
  gallerySourceSlugs?: string[]
  description: string
  tags: string[]
  accent: string
  coverUrl?: string
  images: CatalogImage[]
}

export type QuoteRequest = {
  name: string
  email: string
  notes: string
  modelIds: string[]
}
