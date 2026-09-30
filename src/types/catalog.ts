export type CatalogCategory = {
  id: string
  label: string
  count: number
}

export type CatalogFranchise = {
  id: string
  label: string
  count: number
  category: string
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
  material: string
  heightCm: number
  galleryCount: number
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
