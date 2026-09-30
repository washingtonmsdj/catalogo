type Env = {
  DB: {
    prepare(sql: string): {
      bind(...values: unknown[]): any
      all<T = unknown>(): Promise<{ results: T[] }>
      first<T = unknown>(): Promise<T | null>
      run(): Promise<unknown>
    }
    batch(statements: any[]): Promise<unknown>
  }
}

type CatalogRow = {
  id: string
  slug: string
  code: string
  name: string
  franchise: string
  category: string
  collection: string | null
  image_count: number
  cover_image_id: string | null
}

const json = (data: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(data), {
  ...init,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(init.headers ?? {}) },
})

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const decodeCursor = (cursor: string | null) => cursor ? Number.parseInt(atob(cursor), 10) || 0 : 0
const encodeCursor = (offset: number) => btoa(String(offset))

async function listCatalog(request: Request, env: Env) {
  const url = new URL(request.url)
  const category = url.searchParams.get('category')?.trim() || null
  const franchise = url.searchParams.get('franchise')?.trim() || null
  const query = url.searchParams.get('q')?.trim().toLocaleLowerCase('pt-BR') || null
  const limit = clamp(Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24, 1, 60)
  const offset = decodeCursor(url.searchParams.get('cursor'))

  const where = ['m.published = 1']
  const values: unknown[] = []
  if (category) { where.push('c.slug = ?'); values.push(category) }
  if (franchise) { where.push('f.slug = ?'); values.push(franchise) }
  if (query) { where.push('m.search_text LIKE ?'); values.push(`%${query}%`) }

  const sql = `SELECT m.id,m.slug,m.code,m.name,m.collection,m.image_count,m.cover_image_id,
    f.name AS franchise,c.name AS category
    FROM models m
    JOIN franchises f ON f.id=m.franchise_id
    JOIN categories c ON c.id=f.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.name COLLATE NOCASE, m.id
    LIMIT ? OFFSET ?`
  values.push(limit + 1, offset)

  const result = await env.DB.prepare(sql).bind(...values).all<CatalogRow>()
  const hasMore = result.results.length > limit
  const items = hasMore ? result.results.slice(0, limit) : result.results
  return json({ items, nextCursor: hasMore ? encodeCursor(offset + limit) : null })
}

async function getModel(slug: string, env: Env) {
  const model = await env.DB.prepare(`SELECT m.*,f.name AS franchise,f.slug AS franchise_slug,c.name AS category,c.slug AS category_slug
    FROM models m JOIN franchises f ON f.id=m.franchise_id JOIN categories c ON c.id=f.category_id
    WHERE m.slug=? AND m.published=1 LIMIT 1`).bind(slug).first()
  return model ? json(model) : json({ error: 'model_not_found' }, { status: 404 })
}

async function listImages(request: Request, slug: string, env: Env) {
  const url = new URL(request.url)
  const limit = clamp(Number.parseInt(url.searchParams.get('limit') ?? '24', 10) || 24, 1, 60)
  const offset = decodeCursor(url.searchParams.get('cursor'))
  const model = await env.DB.prepare('SELECT id FROM models WHERE slug=? AND published=1').bind(slug).first<{ id: string }>()
  if (!model) return json({ error: 'model_not_found' }, { status: 404 })

  const result = await env.DB.prepare(`SELECT id,width,height,bytes,mime,role,quality_score,storage_key
    FROM images WHERE model_id=?
    ORDER BY CASE role WHEN 'cover' THEN 0 ELSE 1 END, quality_score DESC, id
    LIMIT ? OFFSET ?`).bind(model.id, limit + 1, offset).all()
  const hasMore = result.results.length > limit
  const items = hasMore ? result.results.slice(0, limit) : result.results
  return json({ items, nextCursor: hasMore ? encodeCursor(offset + limit) : null })
}

async function createQuote(request: Request, env: Env) {
  const body = await request.json() as { name?: string; email?: string; notes?: string; modelIds?: string[] }
  const name = body.name?.trim()
  const email = body.email?.trim().toLowerCase()
  const modelIds = Array.from(new Set(body.modelIds ?? [])).slice(0, 100)
  if (!name || !email || !email.includes('@') || !modelIds.length) return json({ error: 'invalid_request' }, { status: 400 })

  const id = crypto.randomUUID()
  const statements = [
    env.DB.prepare('INSERT INTO quote_requests(id,name,email,notes) VALUES(?,?,?,?)').bind(id, name, email, body.notes?.trim() || null),
    ...modelIds.map((modelId) => env.DB.prepare('INSERT INTO quote_request_items(quote_request_id,model_id,quantity) VALUES(?,?,1)').bind(id, modelId)),
  ]
  await env.DB.batch(statements)
  return json({ id, status: 'received' }, { status: 201 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/catalog') return listCatalog(request, env)
    const imageMatch = url.pathname.match(/^\/api\/models\/([^/]+)\/images$/)
    if (request.method === 'GET' && imageMatch) return listImages(request, decodeURIComponent(imageMatch[1]), env)
    const modelMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/)
    if (request.method === 'GET' && modelMatch) return getModel(decodeURIComponent(modelMatch[1]), env)
    if (request.method === 'POST' && url.pathname === '/api/quotes') return createQuote(request, env)
    if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true, service: 'tonecos-catalogo' })
    return json({ error: 'not_found' }, { status: 404 })
  },
}
