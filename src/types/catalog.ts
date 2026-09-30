export type CatalogCategory = {
  id: string
  label: string
  count: number
}

export type CatalogImage = {
  id: string
  url?: string
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
  category: string
  collection: string
  material: string
  heightCm: number
  galleryCount: number
  description: string
  tags: string[]
  accent: string
  images: CatalogImage[]
}

export type QuoteRequest = {
  name: string
  email: string
  notes: string
  modelIds: string[]
}
