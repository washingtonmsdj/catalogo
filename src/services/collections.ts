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

function normalizeCollections(value: unknown): UserCollection[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.map(cleanCollection).filter((item): item is UserCollection => Boolean(item)).filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }).slice(0, MAX_COLLECTIONS)
}

function collectionEnvelope(collections: UserCollection[]): CollectionEnvelope {
  return {
    version: COLLECTION_STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    collections: normalizeCollections(collections),
  }
}

export function parseCollectionsBackup(raw: string): UserCollection[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('collection_backup_invalid_json')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('collection_backup_invalid')
  const envelope = parsed as Partial<CollectionEnvelope>
  if (envelope.version !== COLLECTION_STORAGE_VERSION) throw new Error('collection_backup_version')
  if (!Array.isArray(envelope.collections)) throw new Error('collection_backup_invalid')
  return normalizeCollections(envelope.collections)
}

export function serializeCollectionsBackup(collections: UserCollection[]) {
  return JSON.stringify(collectionEnvelope(collections), null, 2)
}

export function loadCollections(): UserCollection[] {
  try {
    const raw = localStorage.getItem(COLLECTION_STORAGE_KEY)
    if (!raw) return []
    return parseCollectionsBackup(raw)
  } catch {
    return []
  }
}

export function saveCollections(collections: UserCollection[]) {
  try {
    localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(collectionEnvelope(collections)))
    return true
  } catch {
    return false
  }
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
