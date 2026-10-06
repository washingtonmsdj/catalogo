export type GalleryImage = {
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

export type GalleryManifest = {
  version: number
  modelId: string
  generatedAt?: string
  images: GalleryImage[]
}

export type GalleryModelState = {
  id: string
  image_count: number
  gallery_manifest_key: string | null
  gallery_version: number
  cover_storage_key: string | null
}

function safeMediaKey(value: unknown, modelId: string) {
  if (typeof value !== 'string' || !value) return false
  if (!value.startsWith(`media/${modelId}/`)) return false
  if (value.startsWith('/') || value.includes('\\')) return false
  return !value.split('/').includes('..')
}

function validSha256(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

export function validGalleryImage(image: unknown, modelId: string): image is GalleryImage {
  if (!image || typeof image !== 'object') return false
  const candidate = image as Partial<GalleryImage>
  if (typeof candidate.id !== 'string' || !candidate.id) return false
  if (candidate.role !== 'cover' && candidate.role !== 'gallery') return false
  if (!Number.isFinite(candidate.width) || Number(candidate.width) <= 0) return false
  if (!Number.isFinite(candidate.height) || Number(candidate.height) <= 0) return false
  if (!Number.isFinite(candidate.bytes) || Number(candidate.bytes) <= 0) return false
  if (!Number.isFinite(candidate.qualityScore) || Number(candidate.qualityScore) < 0) return false
  if (typeof candidate.mime !== 'string' || !candidate.mime.startsWith('image/')) return false
  if (!validSha256(candidate.sourceSha256)) return false
  if (!candidate.variantKeys || typeof candidate.variantKeys !== 'object') return false
  for (const name of ['thumb', 'card', 'detail'] as const) {
    if (!safeMediaKey(candidate.variantKeys[name], modelId)) return false
  }
  if (candidate.variantKeys.original !== undefined && !safeMediaKey(candidate.variantKeys.original, modelId)) {
    return false
  }
  return true
}

export function validGalleryManifest(manifest: unknown, model: GalleryModelState): manifest is GalleryManifest {
  if (!manifest || typeof manifest !== 'object') return false
  if (!model.id || !Number.isInteger(model.image_count) || model.image_count < 1) return false
  if (!Number.isInteger(model.gallery_version) || model.gallery_version < 1) return false

  const candidate = manifest as Partial<GalleryManifest>
  if (candidate.modelId !== model.id) return false
  if (!Number.isInteger(candidate.version) || candidate.version !== model.gallery_version) return false
  if (!Array.isArray(candidate.images) || candidate.images.length !== model.image_count) return false
  if (!candidate.images.every((image) => validGalleryImage(image, model.id))) return false

  const ids = new Set(candidate.images.map((image) => image.id))
  if (ids.size !== candidate.images.length) return false
  const covers = candidate.images.filter((image) => image.role === 'cover')
  if (covers.length !== 1 || candidate.images[0].role !== 'cover') return false
  if (
    typeof model.cover_storage_key !== 'string'
    || !model.cover_storage_key
    || candidate.images[0].variantKeys.card !== model.cover_storage_key
  ) {
    return false
  }
  return true
}
