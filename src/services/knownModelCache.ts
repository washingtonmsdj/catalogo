import { loadCollections } from './collections'
import {
  compactKnownModelCache,
  type KnownModelSummary,
} from './knownModelCacheCore'

export {
  compactKnownModelCache,
  DEFAULT_TRANSIENT_KNOWN_MODEL_LIMIT,
  type KnownModelSummary,
} from './knownModelCacheCore'

export const KNOWN_MODELS_STORAGE_KEY = 'tonecos:known-models'

const PROTECTED_MODEL_ID_KEYS = [
  'tonecos:favorites',
  'tonecos:quote',
  'tonecos:compare',
  'tonecos:recent-models',
] as const

function readStoredIds(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  } catch {
    return []
  }
}

export function readProtectedKnownModelIds(extraIds: Iterable<string> = []) {
  const ids = new Set<string>(extraIds)
  for (const key of PROTECTED_MODEL_ID_KEYS) {
    for (const id of readStoredIds(key)) ids.add(id)
  }
  for (const collection of loadCollections()) {
    for (const id of collection.modelIds) ids.add(id)
  }
  return ids
}

export function normalizeKnownModelCache(value: unknown): Record<string, KnownModelSummary> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
    if (!id.trim()) return []
    if (typeof entry === 'string') return [[id, { name: entry, slug: '' }]]
    if (!entry || typeof entry !== 'object') return []

    const model = entry as Partial<KnownModelSummary>
    if (typeof model.name !== 'string') return []
    return [[id, {
      name: model.name,
      slug: typeof model.slug === 'string' ? model.slug : '',
    }]]
  }))
}

export function readKnownModelCache(): Record<string, KnownModelSummary> {
  try {
    return normalizeKnownModelCache(JSON.parse(localStorage.getItem(KNOWN_MODELS_STORAGE_KEY) ?? '{}'))
  } catch {
    return {}
  }
}

export function writeKnownModelCache(models: Record<string, KnownModelSummary>) {
  try {
    localStorage.setItem(KNOWN_MODELS_STORAGE_KEY, JSON.stringify(models))
    return true
  } catch {
    return false
  }
}

export function mergeAndPersistKnownModels(
  updates: Record<string, KnownModelSummary>,
  extraProtectedIds: Iterable<string> = Object.keys(updates),
) {
  const merged = { ...readKnownModelCache(), ...updates }
  const compacted = compactKnownModelCache(
    merged,
    readProtectedKnownModelIds(extraProtectedIds),
  )
  return writeKnownModelCache(compacted)
}
