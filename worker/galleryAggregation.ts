import {
  validGalleryManifest,
  type GalleryImage,
  type GalleryManifest,
  type GalleryModelState,
} from './galleryValidation'

export type GallerySourceState = GalleryModelState & {
  position: number
}

export type GallerySourcePayload = {
  source: GallerySourceState
  manifest: unknown
}

export type AggregatedGallery = {
  images: GalleryImage[]
  total: number
  version: number
}

function safePositiveSum(values: number[], label: string) {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new Error(`invalid_${label}`)
  }
  return total
}

export function logicalGalleryImageCount(sources: GallerySourceState[]) {
  return safePositiveSum(sources.map((source) => source.image_count), 'gallery_image_count')
}

export function logicalGalleryVersion(sources: GallerySourceState[]) {
  return safePositiveSum(sources.map((source) => source.gallery_version), 'gallery_version')
}

export function aggregateGallerySources(payloads: GallerySourcePayload[]): AggregatedGallery {
  if (!payloads.length) throw new Error('gallery_sources_empty')

  const ordered = [...payloads].sort((left, right) => {
    const position = left.source.position - right.source.position
    return position || left.source.id.localeCompare(right.source.id)
  })

  const images: GalleryImage[] = []
  const multipleSources = ordered.length > 1
  for (const { source, manifest } of ordered) {
    if (!validGalleryManifest(manifest, source)) {
      throw new Error(`gallery_source_invalid:${source.id}`)
    }

    for (const image of (manifest as GalleryManifest).images) {
      images.push({
        ...image,
        id: multipleSources ? `${source.id}:${image.id}` : image.id,
        role: images.length === 0 ? 'cover' : 'gallery',
      })
    }
  }

  const sources = ordered.map(({ source }) => source)
  const total = logicalGalleryImageCount(sources)
  if (images.length !== total) throw new Error('gallery_aggregate_count_mismatch')

  return {
    images,
    total,
    version: logicalGalleryVersion(sources),
  }
}
