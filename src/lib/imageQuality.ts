import type { CatalogImage } from '../types/catalog'

const formatWeight = (url?: string) => {
  const extension = url?.split('.').pop()?.toLowerCase()
  if (extension === 'avif') return 4
  if (extension === 'webp') return 3
  if (extension === 'png') return 2
  if (extension === 'jpg' || extension === 'jpeg') return 1
  return 0
}

export function imageQualityScore(image: CatalogImage): number {
  const megapixels = (image.width * image.height) / 1_000_000
  const sizeMb = image.bytes / 1_000_000
  return megapixels * 12 + Math.min(sizeMb, 8) + formatWeight(image.url) * 0.25 + image.qualityScore
}

export function chooseBestDuplicate(images: CatalogImage[]): CatalogImage | undefined {
  return [...images].sort((a, b) => imageQualityScore(b) - imageQualityScore(a))[0]
}

export function chooseCover(images: CatalogImage[]): CatalogImage | undefined {
  const explicit = images.filter((image) => image.role === 'cover')
  return chooseBestDuplicate(explicit.length ? explicit : images)
}
