export const COLLECTION_STORAGE_KEY = 'tonecos:collections'
export const COLLECTION_STORAGE_VERSION = 1
export const MAX_COLLECTIONS = 20
export const MAX_COLLECTION_MODELS = 100
export const MAX_COLLECTION_NAME = 48

export type UserCollection = {
  id: string
  name: string
  modelIds: string[]
  createdAt: string
  updatedAt: string
}

type CollectionEnvelope = {
  version: number
  updatedAt: string
  collections: UserCollection[]
}

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))).slice(0, MAX_COLLECTION_MODELS)
}

function cleanCollection(value: unknown): UserCollection | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<UserCollection>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const name = typeof item.name === 'string' ? item.name.trim().slice(0, MAX_COLLECTION_NAME) : ''
  if (!id || !name) return null
  const now = new Date().toISOString()
  return {
    id,
    name,
    modelIds: cleanIds(item.modelIds),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
  }
}

export function loadCollections(): UserCollection[] {
  try {
    const raw = localStorage.getItem(COLLECTION_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<CollectionEnvelope>
    if (parsed.version !== COLLECTION_STORAGE_VERSION || !Array.isArray(parsed.collections)) return []
    const seen = new Set<string>()
    return parsed.collections.map(cleanCollection).filter((item): item is UserCollection => Boolean(item)).filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    }).slice(0, MAX_COLLECTIONS)
  } catch {
    return []
  }
}

export function saveCollections(collections: UserCollection[]) {
  const normalized = collections.map(cleanCollection).filter((item): item is UserCollection => Boolean(item)).slice(0, MAX_COLLECTIONS)
  const envelope: CollectionEnvelope = {
    version: COLLECTION_STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    collections: normalized,
  }
  localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(envelope))
}

export function createCollection(name: string, initialModelId?: string): UserCollection {
  const cleanName = name.trim().slice(0, MAX_COLLECTION_NAME)
  if (!cleanName) throw new Error('collection_name_required')
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: cleanName,
    modelIds: initialModelId?.trim() ? [initialModelId.trim()] : [],
    createdAt: now,
    updatedAt: now,
  }
}

export function renameCollection(collection: UserCollection, name: string): UserCollection {
  const cleanName = name.trim().slice(0, MAX_COLLECTION_NAME)
  if (!cleanName) throw new Error('collection_name_required')
  return { ...collection, name: cleanName, updatedAt: new Date().toISOString() }
}

export function toggleCollectionModel(collection: UserCollection, modelId: string): UserCollection {
  const cleanId = modelId.trim()
  if (!cleanId) return collection
  if (collection.modelIds.includes(cleanId)) {
    return { ...collection, modelIds: collection.modelIds.filter((id) => id !== cleanId), updatedAt: new Date().toISOString() }
  }
  if (collection.modelIds.length >= MAX_COLLECTION_MODELS) throw new Error('collection_model_limit')
  return { ...collection, modelIds: [...collection.modelIds, cleanId], updatedAt: new Date().toISOString() }
}
