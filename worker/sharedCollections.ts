import { resolvePublicModelIds } from './modelAliases'
type D1Statement = {
  bind(...values: unknown[]): D1Statement
  all<T = unknown>(): Promise<{ results: T[] }>
  first<T = unknown>(): Promise<T | null>
  run(): Promise<unknown>
}

type D1Database = {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown>
}

type R2ObjectBody = {
  json<T = unknown>(): Promise<T>
}

type R2Bucket = {
  get(key: string): Promise<R2ObjectBody | null>
}

type SharedEnv = {
  DB: D1Database
  MEDIA: R2Bucket
  CORS_ORIGINS: string
  TURNSTILE_SECRET_KEY?: string
}

type Helpers = {
  allowedOrigin: (request: Request, env: SharedEnv) => string | null
  json: (request: Request, env: SharedEnv, data: unknown, init?: ResponseInit, cacheControl?: string) => Response
  validateTurnstile: (request: Request, env: SharedEnv, token: string, action?: string) => Promise<boolean>
}

type SharedCollectionRow = {
  code: string
  name: string
  item_count: number
  created_at: number
  expires_at: number
}

type SharedModelRow = {
  id: string
  slug: string
  code: string
  name: string
  variant_name: string
  franchise: string
  category: string
  position: number
}

const MAX_SHARED_ITEMS = 100
const MAX_SHARED_NAME = 48
const SHARED_TTL_SECONDS = 30 * 24 * 60 * 60

function publicCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `TCL-${token}`
}

async function fingerprint(name: string, modelIds: string[]) {
  const canonical = JSON.stringify({ name: name.toLocaleLowerCase('pt-BR'), modelIds })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function collectionPayload(row: SharedCollectionRow, items: SharedModelRow[], deduplicated = false) {
  return {
    code: row.code,
    name: row.name,
    itemCount: row.item_count,
    availableCount: items.length,
    createdAt: new Date(row.created_at * 1000).toISOString(),
    expiresAt: new Date(row.expires_at * 1000).toISOString(),
    deduplicated,
    items: items.map(({ position: _position, ...item }) => item),
  }
}

async function loadItems(env: SharedEnv, code: string) {
  const result = await env.DB.prepare(`SELECT
    resolved.id,resolved.slug,resolved.code,resolved.name,resolved.variant_name,
    f.name AS franchise,c.name AS category,sci.position
    FROM shared_collection_items sci
    JOIN models requested ON requested.id=sci.model_id
    LEFT JOIN model_gallery_members member ON member.source_model_id=requested.id
    JOIN models resolved ON resolved.id=COALESCE(member.canonical_model_id,requested.id)
    JOIN franchises f ON f.id=resolved.franchise_id
    JOIN categories c ON c.id=f.category_id
    WHERE sci.collection_code=? AND resolved.published=1
    ORDER BY sci.position`).bind(code).all<SharedModelRow>()

  const seen = new Set<string>()
  return result.results.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export async function createSharedCollection(request: Request, env: SharedEnv, helpers: Helpers) {
  const requestOrigin = request.headers.get('origin')
  if (requestOrigin && !helpers.allowedOrigin(request, env)) {
    return helpers.json(request, env, { error: 'origin_not_allowed' }, { status: 403 })
  }
  if (!env.TURNSTILE_SECRET_KEY) {
    return helpers.json(request, env, { error: 'share_protection_not_configured' }, { status: 503 })
  }

  let body: { name?: unknown; modelIds?: unknown; turnstileToken?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return helpers.json(request, env, { error: 'invalid_json' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : ''
  const rawIds = Array.isArray(body.modelIds) ? body.modelIds : []
  const requestedModelIds = Array.from(new Set(rawIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)))

  if (!name || name.length > MAX_SHARED_NAME || !requestedModelIds.length) {
    return helpers.json(request, env, { error: 'invalid_request' }, { status: 400 })
  }
  if (requestedModelIds.length > MAX_SHARED_ITEMS) {
    return helpers.json(request, env, { error: 'too_many_models', maxItems: MAX_SHARED_ITEMS }, { status: 400 })
  }
  if (!await helpers.validateTurnstile(request, env, token, 'collection-share')) {
    return helpers.json(request, env, { error: 'turnstile_failed' }, { status: 400 })
  }

  const modelIds = await resolvePublicModelIds(env.DB, requestedModelIds)
  if (!modelIds || !modelIds.length) {
    return helpers.json(request, env, { error: 'invalid_models' }, { status: 400 })
  }

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SHARED_TTL_SECONDS
  const contentFingerprint = await fingerprint(name, modelIds)
  await env.DB.prepare('DELETE FROM shared_collections WHERE expires_at<=?').bind(now).run()
  const existing = await env.DB.prepare(
    'SELECT code,name,item_count,created_at,expires_at FROM shared_collections WHERE fingerprint=? AND expires_at>? LIMIT 1',
  ).bind(contentFingerprint, now).first<SharedCollectionRow>()
  if (existing) {
    const items = await loadItems(env, existing.code)
    return helpers.json(request, env, collectionPayload(existing, items, true))
  }

  const code = publicCode()
  const itemValues: unknown[] = []
  const itemRows = modelIds.map((modelId, position) => {
    itemValues.push(code, modelId, position)
    return '(?,?,?)'
  }).join(',')

  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO shared_collections(code,fingerprint,name,item_count,created_at,expires_at) VALUES(?,?,?,?,?,?)')
        .bind(code, contentFingerprint, name, modelIds.length, now, expiresAt),
      env.DB.prepare(`INSERT INTO shared_collection_items(collection_code,model_id,position) VALUES ${itemRows}`)
        .bind(...itemValues),
    ])
  } catch (error) {
    const concurrent = await env.DB.prepare(
      'SELECT code,name,item_count,created_at,expires_at FROM shared_collections WHERE fingerprint=? AND expires_at>? LIMIT 1',
    ).bind(contentFingerprint, now).first<SharedCollectionRow>()
    if (!concurrent) throw error
    const items = await loadItems(env, concurrent.code)
    return helpers.json(request, env, collectionPayload(concurrent, items, true))
  }

  const row: SharedCollectionRow = { code, name, item_count: modelIds.length, created_at: now, expires_at: expiresAt }
  const items = await loadItems(env, code)
  return helpers.json(request, env, collectionPayload(row, items), { status: 201 })
}

export async function getSharedCollection(request: Request, code: string, env: SharedEnv, helpers: Helpers) {
  if (!/^TCL-[A-Za-z0-9_-]{16}$/.test(code)) {
    return helpers.json(request, env, { error: 'shared_collection_not_found' }, { status: 404 })
  }
  const now = Math.floor(Date.now() / 1000)
  const row = await env.DB.prepare(
    'SELECT code,name,item_count,created_at,expires_at FROM shared_collections WHERE code=? AND expires_at>? LIMIT 1',
  ).bind(code, now).first<SharedCollectionRow>()
  if (!row) return helpers.json(request, env, { error: 'shared_collection_not_found' }, { status: 404 })
  const items = await loadItems(env, code)
  return helpers.json(request, env, collectionPayload(row, items), {}, 'public, max-age=60, s-maxage=300')
}
