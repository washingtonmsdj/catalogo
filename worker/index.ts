import { createSharedCollection, getSharedCollection } from './sharedCollections'

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

type Env = {
  DB: D1Database
  MEDIA: R2Bucket
  CORS_ORIGINS?: string
  TURNSTILE_SECRET_KEY?: string
}

type CatalogRow = {
  id: string
  slug: string
  code: string
  name: string
  franchise: string
  franchise_slug: string
  category: string
  category_slug: string
  collection: string | null
  folder_path: string | null
  image_count: number
  cover_storage_key: string | null
}

type CatalogCursor = {
  name: string
  id: string
}

type GalleryImage = {
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

type GalleryManifest = {
  version: number
  modelId: string
  generatedAt?: string
  images: GalleryImage[]
}

type TurnstileResult = {
  success: boolean
  action?: string
  hostname?: string
  'error-codes'?: string[]
}

type QuoteRecord = {
  id: string
  reference: string | null
}

const DEFAULT_ORIGINS = [
  'https://washingtonmsdj.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]
const MAX_QUOTE_ITEMS = 50
const QUOTE_DEDUP_MINUTES = 10

function allowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get('origin')
  if (!origin) return null
  const configured = (env.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  return [...DEFAULT_ORIGINS, ...configured].includes(origin) ? origin : null
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = allowedOrigin(request, env)
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  }
}

function json(request: Request, env: Env, data: unknown, init: ResponseInit = {}, cacheControl = 'no-store') {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', cacheControl)
  for (const [name, value] of Object.entries(corsHeaders(request, env))) headers.set(name, value)
  return new Response(JSON.stringify(data), { ...init, headers })
}

function options(request: Request, env: Env) {
  if (!allowedOrigin(request, env)) return new Response(null, { status: 403 })
  return new Response(null, { status: 204, headers: corsHeaders(request, env) })
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function encodeUtf8Base64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeUtf8Base64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function encodeCatalogCursor(row: Pick<CatalogRow, 'name' | 'id'>) {
  return encodeUtf8Base64Url(JSON.stringify({ name: row.name, id: row.id }))
}

function decodeCatalogCursor(cursor: string | null): CatalogCursor | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(decodeUtf8Base64Url(cursor)) as Partial<CatalogCursor>
    if (typeof parsed.name !== 'string' || typeof parsed.id !== 'string' || !parsed.id) return null
    return { name: parsed.name, id: parsed.id }
  } catch {
    return null
  }
}

function decodeOffsetCursor(cursor: string | null): number | null {
  if (!cursor) return 0
  try {
    const parsed = Number.parseInt(atob(cursor), 10)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
  } catch {
    return null
  }
}

function toFtsPhrase(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteReference(id: string) {
  const compact = id.replace(/-/g, '').slice(0, 20).toUpperCase()
  return `TCS-${compact.match(/.{1,4}/g)?.join('-') ?? compact}`
}

async function deterministicQuoteId(name: string, email: string, notes: string, modelIds: string[]) {
  const bucket = Math.floor(Date.now() / (QUOTE_DEDUP_MINUTES * 60_000))
  const canonical = JSON.stringify({ bucket, name, email, notes, modelIds: [...modelIds].sort() })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

async function findRecentDuplicateQuote(env: Env, name: string, email: string, notes: string, modelIds: string[]) {
  const placeholders = modelIds.map(() => '?').join(',')
  return env.DB.prepare(`SELECT qr.id,qr.reference
    FROM quote_requests qr
    WHERE qr.name=? AND qr.email=? AND COALESCE(qr.notes,'')=?
      AND qr.created_at >= datetime('now', '-${QUOTE_DEDUP_MINUTES} minutes')
      AND (SELECT COUNT(*) FROM quote_request_items qi WHERE qi.quote_request_id=qr.id)=?
      AND (SELECT COUNT(*) FROM quote_request_items qi WHERE qi.quote_request_id=qr.id AND qi.model_id IN (${placeholders}))=?
    ORDER BY qr.created_at DESC
    LIMIT 1`)
    .bind(name, email, notes, modelIds.length, ...modelIds, modelIds.length)
    .first<QuoteRecord>()
}

function quoteResponse(request: Request, env: Env, quote: QuoteRecord, deduplicated: boolean, status = 200) {
  return json(request, env, {
    reference: quote.reference || quoteReference(quote.id),
    status: 'received',
    deduplicated,
  }, { status })
}

const encodeOffsetCursor = (offset: number) => btoa(String(offset))

async function listCategories(request: Request, env: Env) {
  const result = await env.DB.prepare(`WITH ranked_franchises AS (
      SELECT f.id,f.category_id,
        ROW_NUMBER() OVER (PARTITION BY f.category_id ORDER BY f.model_count DESC,f.name COLLATE NOCASE,f.id) AS rank_in_category
      FROM franchises f
    ), representative AS (
      SELECT rf.category_id,
        (SELECT m.cover_storage_key
         FROM models m
         WHERE m.franchise_id=rf.id
           AND m.published=1
           AND m.cover_storage_key IS NOT NULL
         ORDER BY m.image_count DESC,m.name COLLATE NOCASE,m.id
         LIMIT 1) AS cover_storage_key
      FROM ranked_franchises rf
      WHERE rf.rank_in_category=1
    )
    SELECT c.slug AS id,c.name AS label,c.model_count AS count,representative.cover_storage_key
    FROM categories c
    LEFT JOIN representative ON representative.category_id=c.id
    ORDER BY c.sort_order,c.name COLLATE NOCASE`)
    .all<{ id: string; label: string; count: number; cover_storage_key: string | null }>()
  const total = result.results.reduce((sum, item) => sum + Number(item.count || 0), 0)
  return json(request, env, {
    items: [{ id: 'all', label: 'Todos', count: total, cover_storage_key: null }, ...result.results],
  }, {}, 'public, max-age=300, s-maxage=1800')
}

async function listFranchises(request: Request, env: Env) {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')?.trim() || null
  const query = url.searchParams.get('q')?.trim().toLocaleLowerCase('pt-BR') || null
  const limit = clamp(Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24, 1, 48)

  if (query) {
    const length = Array.from(query).length
    if (length < 3) return json(request, env, { error: 'franchise_search_too_short', minLength: 3 }, { status: 400 })
    if (length > 80) return json(request, env, { error: 'franchise_search_too_long', maxLength: 80 }, { status: 400 })
  }

  const where: string[] = []
  const values: unknown[] = []
  if (category) {
    where.push('c.slug=?')
    values.push(category)
  }
  if (query) {
    where.push('franchises_fts MATCH ?')
    values.push(toFtsPhrase(query))
  }

  const searchJoin = query ? 'JOIN franchises_fts ON franchises_fts.franchise_id=f.id' : ''
  const sql = `SELECT f.slug AS id,f.name AS label,f.model_count AS count,c.slug AS category,
      (SELECT m.cover_storage_key
       FROM models m
       WHERE m.franchise_id=f.id
         AND m.published=1
         AND m.cover_storage_key IS NOT NULL
       ORDER BY m.image_count DESC,m.name COLLATE NOCASE,m.id
       LIMIT 1) AS cover_storage_key
    FROM franchises f
    JOIN categories c ON c.id=f.category_id
    ${searchJoin}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY f.model_count DESC,f.name COLLATE NOCASE,f.id
    LIMIT ?`
  values.push(limit + 1)
  const result = await env.DB.prepare(sql).bind(...values)
    .all<{ id: string; label: string; count: number; category: string; cover_storage_key: string | null }>()
  const truncated = result.results.length > limit
  const items = truncated ? result.results.slice(0, limit) : result.results
  const cacheControl = query ? 'public, max-age=60, s-maxage=300' : 'public, max-age=300, s-maxage=1800'
  return json(request, env, { items, truncated }, {}, cacheControl)
}

async function listFolders(request: Request, env: Env) {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')?.trim() || ''
  const franchise = url.searchParams.get('franchise')?.trim() || ''
  const parent = url.searchParams.get('parent')?.trim() || ''
  if (!category || !franchise) return json(request, env, { error: 'folder_scope_required' }, { status: 400 })
  if (parent.length > 240) return json(request, env, { error: 'folder_path_too_long' }, { status: 400 })

  const result = await env.DB.prepare(`WITH RECURSIVE roots AS (
      SELECT cf.id,cf.path,cf.name
      FROM catalog_folders cf
      JOIN franchises f ON f.id=cf.franchise_id
      JOIN categories c ON c.id=f.category_id
      WHERE c.slug=? AND f.slug=? AND (
        (?='' AND cf.parent_id IS NULL) OR
        (?<>'' AND cf.parent_id=(SELECT p.id FROM catalog_folders p WHERE p.franchise_id=f.id AND p.path=? LIMIT 1))
      )
    ), subtree(root_id,id) AS (
      SELECT id,id FROM roots
      UNION ALL
      SELECT subtree.root_id,child.id
      FROM subtree JOIN catalog_folders child ON child.parent_id=subtree.id
    )
    SELECT r.path AS id,r.name AS label,COUNT(m.id) AS count,
      EXISTS(SELECT 1 FROM catalog_folders child WHERE child.parent_id=r.id) AS has_children
    FROM roots r
    LEFT JOIN subtree s ON s.root_id=r.id
    LEFT JOIN models m ON m.folder_id=s.id AND m.published=1
    GROUP BY r.id,r.path,r.name
    ORDER BY r.name COLLATE NOCASE,r.id`).bind(category, franchise, parent, parent, parent)
    .all<{ id: string; label: string; count: number; has_children: number }>()

  const current = parent ? await env.DB.prepare(`WITH RECURSIVE current_folder AS (
      SELECT cf.id,cf.path,cf.name
      FROM catalog_folders cf
      JOIN franchises f ON f.id=cf.franchise_id
      JOIN categories c ON c.id=f.category_id
      WHERE c.slug=? AND f.slug=? AND cf.path=?
    ), scope(id) AS (
      SELECT id FROM current_folder
      UNION ALL
      SELECT child.id FROM catalog_folders child JOIN scope ON child.parent_id=scope.id
    )
    SELECT current_folder.path AS id,current_folder.name AS label,COUNT(m.id) AS count
    FROM current_folder
    LEFT JOIN scope ON 1=1
    LEFT JOIN models m ON m.folder_id=scope.id AND m.published=1
    GROUP BY current_folder.id,current_folder.path,current_folder.name`).bind(category, franchise, parent)
    .first<{ id: string; label: string; count: number }>() : null

  if (parent && !current) {
    return json(request, env, { error: 'folder_not_found' }, { status: 404 }, 'no-store')
  }

  const trail = parent ? await env.DB.prepare(`WITH RECURSIVE ancestors AS (
      SELECT cf.id,cf.parent_id,cf.path,cf.name,cf.depth
      FROM catalog_folders cf
      JOIN franchises f ON f.id=cf.franchise_id
      JOIN categories c ON c.id=f.category_id
      WHERE c.slug=? AND f.slug=? AND cf.path=?
      UNION ALL
      SELECT parent_folder.id,parent_folder.parent_id,parent_folder.path,parent_folder.name,parent_folder.depth
      FROM catalog_folders parent_folder
      JOIN ancestors child ON child.parent_id=parent_folder.id
    )
    SELECT path AS id,name AS label,depth
    FROM ancestors
    ORDER BY depth,path`).bind(category, franchise, parent)
    .all<{ id: string; label: string; depth: number }>() : { results: [] }

  return json(request, env, {
    current: current ? { id: current.id, label: current.label, count: Number(current.count || 0) } : null,
    trail: trail.results.map((item) => ({ id: item.id, label: item.label })),
    items: result.results.map((item) => ({
      id: item.id,
      label: item.label,
      count: Number(item.count || 0),
      hasChildren: Boolean(item.has_children),
    })),
  }, {}, 'public, max-age=300, s-maxage=1800')
}

async function listCatalog(request: Request, env: Env) {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')?.trim() || null
  const franchise = url.searchParams.get('franchise')?.trim() || null
  const folder = url.searchParams.get('folder')?.trim() || null
  const query = url.searchParams.get('q')?.trim().toLocaleLowerCase('pt-BR') || null
  const limit = clamp(Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24, 1, 60)
  const rawCursor = url.searchParams.get('cursor')
  const cursor = decodeCatalogCursor(rawCursor)
  if (rawCursor && !cursor) return json(request, env, { error: 'invalid_cursor' }, { status: 400 })

  if (query) {
    const length = Array.from(query).length
    if (length < 3) return json(request, env, { error: 'search_too_short', minLength: 3 }, { status: 400 })
    if (length > 120) return json(request, env, { error: 'search_too_long', maxLength: 120 }, { status: 400 })
  }

  const where = ['m.published = 1']
  const values: unknown[] = []
  let folderCte = ''
  if (folder) {
    if (!category || !franchise) return json(request, env, { error: 'folder_scope_required' }, { status: 400 })
    if (folder.length > 240) return json(request, env, { error: 'folder_path_too_long' }, { status: 400 })
    const folderExists = await env.DB.prepare(`SELECT 1
      FROM catalog_folders cf
      JOIN franchises f ON f.id=cf.franchise_id
      JOIN categories c ON c.id=f.category_id
      WHERE c.slug=? AND f.slug=? AND cf.path=?
      LIMIT 1`).bind(category, franchise, folder).first()
    if (!folderExists) return json(request, env, { error: 'folder_not_found' }, { status: 404 }, 'no-store')
    folderCte = `WITH RECURSIVE folder_scope(id) AS (
      SELECT cf.id FROM catalog_folders cf
      JOIN franchises ff ON ff.id=cf.franchise_id
      JOIN categories cc ON cc.id=ff.category_id
      WHERE cc.slug=? AND ff.slug=? AND cf.path=?
      UNION ALL
      SELECT child.id FROM catalog_folders child JOIN folder_scope scope ON child.parent_id=scope.id
    )`
    values.push(category, franchise, folder)
    where.push('m.folder_id IN (SELECT id FROM folder_scope)')
  }
  if (category) { where.push('c.slug = ?'); values.push(category) }
  if (franchise) { where.push('f.slug = ?'); values.push(franchise) }
  if (query) { where.push('models_fts MATCH ?'); values.push(toFtsPhrase(query)) }
  if (cursor) {
    where.push('(m.name COLLATE NOCASE > ? COLLATE NOCASE OR (m.name COLLATE NOCASE = ? COLLATE NOCASE AND m.id > ?))')
    values.push(cursor.name, cursor.name, cursor.id)
  }

  const searchJoin = query ? 'JOIN models_fts ON models_fts.model_id = m.id' : ''
  const sql = `${folderCte} SELECT m.id,m.slug,m.code,m.name,m.collection,cf.path AS folder_path,m.image_count,m.cover_storage_key,
    f.name AS franchise,f.slug AS franchise_slug,c.name AS category,c.slug AS category_slug
    FROM models m
    JOIN franchises f ON f.id=m.franchise_id
    JOIN categories c ON c.id=f.category_id
    LEFT JOIN catalog_folders cf ON cf.id=m.folder_id
    ${searchJoin}
    WHERE ${where.join(' AND ')}
    ORDER BY m.name COLLATE NOCASE, m.id
    LIMIT ?`
  values.push(limit + 1)

  const result = await env.DB.prepare(sql).bind(...values).all<CatalogRow>()
  const hasMore = result.results.length > limit
  const items = hasMore ? result.results.slice(0, limit) : result.results
  const lastItem = items.at(-1)
  return json(request, env, {
    items,
    nextCursor: hasMore && lastItem ? encodeCatalogCursor(lastItem) : null,
  }, {}, 'public, max-age=30, s-maxage=120')
}

async function getModel(request: Request, slug: string, env: Env) {
  const model = await env.DB.prepare(`SELECT m.*,cf.path AS folder_path,f.name AS franchise,f.slug AS franchise_slug,c.name AS category,c.slug AS category_slug
    FROM models m JOIN franchises f ON f.id=m.franchise_id JOIN categories c ON c.id=f.category_id
    LEFT JOIN catalog_folders cf ON cf.id=m.folder_id
    WHERE m.slug=? AND m.published=1 LIMIT 1`).bind(slug).first()
  return model
    ? json(request, env, model, {}, 'public, max-age=300, s-maxage=1800')
    : json(request, env, { error: 'model_not_found' }, { status: 404 })
}

async function listImages(request: Request, slug: string, env: Env) {
  const url = new URL(request.url)
  const limit = clamp(Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24, 1, 60)
  const rawCursor = url.searchParams.get('cursor')
  const offset = decodeOffsetCursor(rawCursor)
  if (offset === null) return json(request, env, { error: 'invalid_cursor' }, { status: 400 })

  const model = await env.DB.prepare(
    'SELECT id,image_count,gallery_manifest_key,gallery_version FROM models WHERE slug=? AND published=1',
  ).bind(slug).first<{ id: string; image_count: number; gallery_manifest_key: string | null; gallery_version: number }>()
  if (!model) return json(request, env, { error: 'model_not_found' }, { status: 404 })
  if (!model.gallery_manifest_key) return json(request, env, { items: [], total: 0, nextCursor: null, version: model.gallery_version })

  const object = await env.MEDIA.get(model.gallery_manifest_key)
  if (!object) return json(request, env, { error: 'gallery_manifest_missing' }, { status: 503 })
  const manifest = await object.json<GalleryManifest>()
  if (manifest.modelId !== model.id || !Array.isArray(manifest.images)) {
    return json(request, env, { error: 'gallery_manifest_invalid' }, { status: 503 })
  }

  const items = manifest.images.slice(offset, offset + limit)
  const nextOffset = offset + items.length
  return json(request, env, {
    items,
    total: manifest.images.length,
    nextCursor: nextOffset < manifest.images.length ? encodeOffsetCursor(nextOffset) : null,
    version: manifest.version,
  }, {}, 'public, max-age=300, s-maxage=1800')
}

async function validateTurnstile(request: Request, env: Env, token: string, action = 'quote') {
  if (!env.TURNSTILE_SECRET_KEY || !token || token.length > 2048) return false

  const body = new FormData()
  body.set('secret', env.TURNSTILE_SECRET_KEY)
  body.set('response', token)
  const remoteIp = request.headers.get('CF-Connecting-IP')
  if (remoteIp) body.set('remoteip', remoteIp)
  body.set('idempotency_key', crypto.randomUUID())

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    const result = await response.json() as TurnstileResult
    return result.success === true && result.action === action
  } catch {
    return false
  }
}

async function createQuote(request: Request, env: Env) {
  const requestOrigin = request.headers.get('origin')
  if (requestOrigin && !allowedOrigin(request, env)) {
    return json(request, env, { error: 'origin_not_allowed' }, { status: 403 })
  }
  if (!env.TURNSTILE_SECRET_KEY) {
    return json(request, env, { error: 'quote_protection_not_configured' }, { status: 503 })
  }

  let body: { name?: unknown; email?: unknown; notes?: unknown; modelIds?: unknown; turnstileToken?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return json(request, env, { error: 'invalid_json' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : ''
  const rawIds = Array.isArray(body.modelIds) ? body.modelIds : []
  const modelIds = Array.from(new Set(rawIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)))

  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || notes.length > 4000 || !modelIds.length) {
    return json(request, env, { error: 'invalid_request' }, { status: 400 })
  }
  if (modelIds.length > MAX_QUOTE_ITEMS) {
    return json(request, env, { error: 'too_many_models', maxItems: MAX_QUOTE_ITEMS }, { status: 400 })
  }
  if (!await validateTurnstile(request, env, turnstileToken)) {
    return json(request, env, { error: 'turnstile_failed' }, { status: 400 })
  }

  const placeholders = modelIds.map(() => '?').join(',')
  const published = await env.DB.prepare(
    `SELECT id FROM models WHERE published=1 AND id IN (${placeholders})`,
  ).bind(...modelIds).all<{ id: string }>()
  if (published.results.length !== modelIds.length) {
    return json(request, env, { error: 'invalid_models' }, { status: 400 })
  }

  const duplicate = await findRecentDuplicateQuote(env, name, email, notes, modelIds)
  if (duplicate) return quoteResponse(request, env, duplicate, true)

  const id = await deterministicQuoteId(name, email, notes, modelIds)
  const reference = quoteReference(id)
  const itemValues: unknown[] = []
  const itemRows = modelIds.map((modelId) => {
    itemValues.push(id, modelId)
    return '(?,?,1)'
  }).join(',')

  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO quote_requests(id,reference,name,email,notes) VALUES(?,?,?,?,?)').bind(id, reference, name, email, notes || null),
      env.DB.prepare(`INSERT INTO quote_request_items(quote_request_id,model_id,quantity) VALUES ${itemRows}`).bind(...itemValues),
    ])
  } catch (error) {
    const concurrent = await env.DB.prepare('SELECT id,reference FROM quote_requests WHERE id=? LIMIT 1').bind(id).first<QuoteRecord>()
    if (concurrent) return quoteResponse(request, env, concurrent, true)
    throw error
  }

  return quoteResponse(request, env, { id, reference }, false, 201)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return options(request, env)
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/categories') return listCategories(request, env)
    if (request.method === 'GET' && url.pathname === '/api/franchises') return listFranchises(request, env)
    if (request.method === 'GET' && url.pathname === '/api/folders') return listFolders(request, env)
    if (request.method === 'GET' && url.pathname === '/api/catalog') return listCatalog(request, env)
    const imageMatch = url.pathname.match(/^\/api\/models\/([^/]+)\/images$/)
    if (request.method === 'GET' && imageMatch) return listImages(request, decodeURIComponent(imageMatch[1]), env)
    const modelMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/)
    if (request.method === 'GET' && modelMatch) return getModel(request, decodeURIComponent(modelMatch[1]), env)
    if (request.method === 'POST' && url.pathname === '/api/shared-collections') {
      return createSharedCollection(request, env, { allowedOrigin, json, validateTurnstile })
    }
    const sharedMatch = url.pathname.match(/^\/api\/shared-collections\/([^/]+)$/)
    if (request.method === 'GET' && sharedMatch) {
      return getSharedCollection(request, decodeURIComponent(sharedMatch[1]), env, { allowedOrigin, json, validateTurnstile })
    }
    if (request.method === 'POST' && url.pathname === '/api/quotes') return createQuote(request, env)
    if (request.method === 'GET' && url.pathname === '/api/health') return json(request, env, { ok: true, service: 'tonecos-catalogo' })
    return json(request, env, { error: 'not_found' }, { status: 404 })
  },
}
