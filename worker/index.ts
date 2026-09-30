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

const DEFAULT_ORIGINS = [
  'https://washingtonmsdj.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

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

const encodeOffsetCursor = (offset: number) => btoa(String(offset))

async function listCategories(request: Request, env: Env) {
  const result = await env.DB.prepare(
    'SELECT slug AS id,name AS label,model_count AS count FROM categories ORDER BY sort_order,name COLLATE NOCASE',
  ).all<{ id: string; label: string; count: number }>()
  const total = result.results.reduce((sum, item) => sum + Number(item.count || 0), 0)
  return json(request, env, {
    items: [{ id: 'all', label: 'Todos', count: total }, ...result.results],
  }, {}, 'public, max-age=300, s-maxage=1800')
}

async function listFranchises(request: Request, env: Env) {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')?.trim() || null
  const where = category ? 'WHERE c.slug=?' : ''
  const statement = env.DB.prepare(`SELECT f.slug AS id,f.name AS label,f.model_count AS count,c.slug AS category
    FROM franchises f JOIN categories c ON c.id=f.category_id ${where}
    ORDER BY f.name COLLATE NOCASE`)
  const result = category
    ? await statement.bind(category).all<{ id: string; label: string; count: number; category: string }>()
    : await statement.all<{ id: string; label: string; count: number; category: string }>()
  return json(request, env, { items: result.results }, {}, 'public, max-age=300, s-maxage=1800')
}

async function listCatalog(request: Request, env: Env) {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')?.trim() || null
  const franchise = url.searchParams.get('franchise')?.trim() || null
  const query = url.searchParams.get('q')?.trim().toLocaleLowerCase('pt-BR') || null
  const limit = clamp(Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24, 1, 60)
  const rawCursor = url.searchParams.get('cursor')
  const cursor = decodeCatalogCursor(rawCursor)
  if (rawCursor && !cursor) return json(request, env, { error: 'invalid_cursor' }, { status: 400 })

  const where = ['m.published = 1']
  const values: unknown[] = []
  if (category) { where.push('c.slug = ?'); values.push(category) }
  if (franchise) { where.push('f.slug = ?'); values.push(franchise) }
  if (query) { where.push('m.search_text LIKE ?'); values.push(`%${query}%`) }
  if (cursor) {
    where.push('(m.name COLLATE NOCASE > ? COLLATE NOCASE OR (m.name COLLATE NOCASE = ? COLLATE NOCASE AND m.id > ?))')
    values.push(cursor.name, cursor.name, cursor.id)
  }

  const sql = `SELECT m.id,m.slug,m.code,m.name,m.collection,m.image_count,m.cover_storage_key,
    f.name AS franchise,f.slug AS franchise_slug,c.name AS category,c.slug AS category_slug
    FROM models m
    JOIN franchises f ON f.id=m.franchise_id
    JOIN categories c ON c.id=f.category_id
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
  const model = await env.DB.prepare(`SELECT m.*,f.name AS franchise,f.slug AS franchise_slug,c.name AS category,c.slug AS category_slug
    FROM models m JOIN franchises f ON f.id=m.franchise_id JOIN categories c ON c.id=f.category_id
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

async function createQuote(request: Request, env: Env) {
  const body = await request.json() as { name?: string; email?: string; notes?: string; modelIds?: string[] }
  const name = body.name?.trim()
  const email = body.email?.trim().toLowerCase()
  const modelIds = Array.from(new Set(body.modelIds ?? [])).slice(0, 100)
  if (!name || !email || !email.includes('@') || !modelIds.length) {
    return json(request, env, { error: 'invalid_request' }, { status: 400 })
  }

  const id = crypto.randomUUID()
  const statements = [
    env.DB.prepare('INSERT INTO quote_requests(id,name,email,notes) VALUES(?,?,?,?)').bind(id, name, email, body.notes?.trim() || null),
    ...modelIds.map((modelId) => env.DB.prepare('INSERT INTO quote_request_items(quote_request_id,model_id,quantity) VALUES(?,?,1)').bind(id, modelId)),
  ]
  await env.DB.batch(statements)
  return json(request, env, { id, status: 'received' }, { status: 201 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return options(request, env)
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/categories') return listCategories(request, env)
    if (request.method === 'GET' && url.pathname === '/api/franchises') return listFranchises(request, env)
    if (request.method === 'GET' && url.pathname === '/api/catalog') return listCatalog(request, env)
    const imageMatch = url.pathname.match(/^\/api\/models\/([^/]+)\/images$/)
    if (request.method === 'GET' && imageMatch) return listImages(request, decodeURIComponent(imageMatch[1]), env)
    const modelMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/)
    if (request.method === 'GET' && modelMatch) return getModel(request, decodeURIComponent(modelMatch[1]), env)
    if (request.method === 'POST' && url.pathname === '/api/quotes') return createQuote(request, env)
    if (request.method === 'GET' && url.pathname === '/api/health') return json(request, env, { ok: true, service: 'tonecos-catalogo' })
    return json(request, env, { error: 'not_found' }, { status: 404 })
  },
}
