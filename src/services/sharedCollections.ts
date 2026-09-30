export type SharedCollectionItem = {
  id: string
  slug: string
  code: string
  name: string
  franchise: string
  category: string
}

export type SharedCollection = {
  code: string
  name: string
  itemCount: number
  availableCount: number
  createdAt: string
  expiresAt: string
  deduplicated?: boolean
  items: SharedCollectionItem[]
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

export function isSharedCollectionsLive() {
  return Boolean(apiBase)
}

export async function createSharedCollection(name: string, modelIds: string[], turnstileToken: string) {
  if (!apiBase) throw new Error('sharing_unavailable')
  const response = await fetch(`${apiBase}/api/shared-collections`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, modelIds, turnstileToken }),
  })
  const body = await response.json().catch(() => null) as (SharedCollection & { error?: string }) | null
  if (!response.ok) throw new Error(body?.error || `shared_collection_create_failed_${response.status}`)
  if (!body?.code || !Array.isArray(body.items)) throw new Error('shared_collection_invalid_response')
  return body
}

export async function fetchSharedCollection(code: string) {
  if (!apiBase) throw new Error('sharing_unavailable')
  const response = await fetch(`${apiBase}/api/shared-collections/${encodeURIComponent(code)}`)
  const body = await response.json().catch(() => null) as (SharedCollection & { error?: string }) | null
  if (!response.ok) throw new Error(body?.error || `shared_collection_fetch_failed_${response.status}`)
  if (!body?.code || !Array.isArray(body.items)) throw new Error('shared_collection_invalid_response')
  return body
}

export function sharedCollectionPublicUrl(code: string) {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('colecao', code)
  return url.toString()
}
