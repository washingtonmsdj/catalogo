/**
 * R26: isolated quote administration service. Deliberately NOT mounted by
 * worker/index.ts or worker/entry.ts while Cloudflare Access is not enabled.
 *
 * Authentication and authorization precede every access to customer data.
 * A second, explicit environment gate denies requests if accidentally mounted.
 */
import {
  authenticateQuoteAdminRequest,
  type AdminAccessEnv,
  type QuoteAdmin,
} from './quoteAdminAccess.ts'
import {
  canReadQuote,
  canTransitionQuote,
  isQuoteStatus,
  type QuoteStatus,
} from './quoteWorkflow.ts'

type Statement = {
  bind(...values: unknown[]): Statement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}
export type QuoteAdminDatabase = { prepare(sql: string): Statement }
export type QuoteAdminServiceEnv = AdminAccessEnv & {
  DB: QuoteAdminDatabase
  QUOTE_ADMIN_ROUTE_ENABLED?: string
}

type Cursor = { createdAt: string; id: string }
type QuoteRow = {
  id: string
  reference: string
  name: string
  email: string
  notes: string | null
  created_at: string
  status: string
  revision: number
}
type ListRow = Pick<QuoteRow, 'id' | 'reference' | 'created_at' | 'status' | 'revision'> & {
  item_count: number
}
type ItemRow = { code: string; name: string; quantity: number }
type EventRow = {
  id: number
  from_status: string
  to_status: string
  actor_email: string
  actor_role: string
  response_text: string | null
  created_at: string
}

const MAX_PAGE = 25
const MAX_BODY = 8192
const REF = /^(?:TCS-[A-Z0-9-]{8,48}|LEGACY-[0-9a-fA-F-]{16,80})$/
const CURRENT_STATUS = "COALESCE((SELECT event.to_status FROM quote_status_events event WHERE event.quote_request_id=q.id ORDER BY event.id DESC LIMIT 1),q.status)"
const CURRENT_REVISION = "COALESCE((SELECT event.id FROM quote_status_events event WHERE event.quote_request_id=q.id ORDER BY event.id DESC LIMIT 1),0)"

const ADMIN_LIST_SQL = [
  "SELECT q.id,q.reference,q.created_at," + CURRENT_STATUS + " AS status,",
  CURRENT_REVISION + " AS revision,",
  "(SELECT COUNT(*) FROM quote_request_items item WHERE item.quote_request_id=q.id) AS item_count",
  "FROM quote_requests q",
  "WHERE (? IS NULL OR q.created_at < ? OR (q.created_at=? AND q.id < ?))",
  "ORDER BY q.created_at DESC,q.id DESC LIMIT ?",
].join(' ')

const ADMIN_DETAIL_SQL = [
  "SELECT q.id,q.reference,q.name,q.email,q.notes,q.created_at,",
  CURRENT_STATUS + " AS status," + CURRENT_REVISION + " AS revision",
  "FROM quote_requests q WHERE q.reference=? LIMIT 1",
].join(' ')

const ADMIN_INSERT_EVENT_SQL = [
  "INSERT INTO quote_status_events",
  "(quote_request_id,from_status,to_status,actor_subject,actor_email,actor_role,response_text)",
  "SELECT q.id,?,?,?,?,?,? FROM quote_requests q",
  "WHERE q.id=? AND q.reference=?",
  "AND " + CURRENT_REVISION + "=?",
].join(' ')

function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'vary': 'Cf-Access-Jwt-Assertion, Origin',
    },
  })
}

function encodeCursor(row: Pick<ListRow, 'created_at' | 'id'>): string {
  const bytes = new TextEncoder().encode(JSON.stringify({
    createdAt: row.created_at, id: row.id,
  }))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeCursor(raw: string): Cursor | null {
  if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - raw.length % 4) % 4)
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const value = parsed as Record<string, unknown>
    if (typeof value.createdAt !== 'string' || value.createdAt.length < 10
      || value.createdAt.length > 40 || typeof value.id !== 'string'
      || value.id.length < 1 || value.id.length > 100) return null
    return { createdAt: value.createdAt, id: value.id }
  } catch { return null }
}

function parseListRequest(url: URL): { limit: number; cursor: Cursor | null } | null {
  let unknownParameter = false
  url.searchParams.forEach((_value, key) => {
    if (key !== 'limit' && key !== 'cursor') unknownParameter = true
  })
  if (unknownParameter) return null
  if (url.searchParams.getAll('limit').length > 1 || url.searchParams.getAll('cursor').length > 1) return null
  const rawLimit = url.searchParams.get('limit')
  if (rawLimit !== null && !/^[1-9][0-9]?$/.test(rawLimit)) return null
  const limit = rawLimit === null ? 20 : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) return null
  const rawCursor = url.searchParams.get('cursor')
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor)
  if (rawCursor !== null && !cursor) return null
  return { limit, cursor }
}

function publicListRow(row: ListRow) {
  return {
    reference: row.reference,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    itemCount: row.item_count,
  }
}

async function listQuotes(request: Request, env: QuoteAdminServiceEnv): Promise<Response> {
  const parsed = parseListRequest(new URL(request.url))
  if (!parsed) return response(400, { error: 'invalid_pagination' })
  const { limit, cursor } = parsed
  const page = await env.DB.prepare(ADMIN_LIST_SQL)
    .bind(cursor?.createdAt ?? null, cursor?.createdAt ?? null,
      cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1)
    .all<ListRow>()
  const hasMore = page.results.length > limit
  const selected = page.results.slice(0, limit)
  return response(200, {
    items: selected.map(publicListRow),
    nextCursor: hasMore && selected.length ? encodeCursor(selected[selected.length - 1]) : null,
  })
}

async function findQuote(env: QuoteAdminServiceEnv, reference: string): Promise<QuoteRow | null> {
  return env.DB.prepare(ADMIN_DETAIL_SQL).bind(reference).first<QuoteRow>()
}

async function detailQuote(env: QuoteAdminServiceEnv, reference: string): Promise<Response> {
  const quote = await findQuote(env, reference)
  if (!quote) return response(404, { error: 'quote_not_found' })
  const [items, events] = await Promise.all([
    env.DB.prepare([
      "SELECT m.code,m.name,item.quantity FROM quote_request_items item",
      "JOIN models m ON m.id=item.model_id",
      "WHERE item.quote_request_id=? ORDER BY m.code",
    ].join(' ')).bind(quote.id).all<ItemRow>(),
    env.DB.prepare([
      "SELECT id,from_status,to_status,actor_email,actor_role,response_text,created_at",
      "FROM quote_status_events WHERE quote_request_id=? ORDER BY id ASC",
    ].join(' ')).bind(quote.id).all<EventRow>(),
  ])
  return response(200, {
    reference: quote.reference,
    name: quote.name,
    email: quote.email,
    notes: quote.notes,
    createdAt: quote.created_at,
    status: quote.status,
    revision: quote.revision,
    items: items.results.map(row => ({
      code: row.code, name: row.name, quantity: row.quantity,
    })),
    history: events.results.map(row => ({
      revision: row.id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorEmail: row.actor_email,
      actorRole: row.actor_role,
      responseText: row.response_text,
      createdAt: row.created_at,
    })),
  })
}

async function parseTransition(request: Request): Promise<{
  expectedStatus: QuoteStatus
  expectedRevision: number
  toStatus: QuoteStatus
  responseText: string | null
} | null> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
    request.headers.get('content-type') || '',
  )) return null
  const declared = request.headers.get('content-length')
  if (declared && Number(declared) > MAX_BODY) return null
  try {
    const text = await request.text()
    if (text.length > MAX_BODY) return null
    const payload: unknown = JSON.parse(text)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const body = payload as Record<string, unknown>
    if (Object.keys(body).some(key => !['expectedStatus', 'expectedRevision', 'toStatus', 'responseText'].includes(key))) return null
    if (!isQuoteStatus(body.expectedStatus) || !isQuoteStatus(body.toStatus)) return null
    if (typeof body.expectedRevision !== 'number'
      || !Number.isSafeInteger(body.expectedRevision)
      || body.expectedRevision < 0) return null
    const responseText = typeof body.responseText === 'string' ? body.responseText.trim() : null
    if (body.toStatus === 'response_recorded') {
      if (!responseText || responseText.length > 4000) return null
    } else if (body.responseText !== undefined && body.responseText !== null) {
      return null
    }
    return {
      expectedStatus: body.expectedStatus,
      expectedRevision: body.expectedRevision,
      toStatus: body.toStatus,
      responseText,
    }
  } catch { return null }
}

function dbChanges(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null
  const meta = (raw as { meta?: { changes?: unknown } }).meta
  return typeof meta?.changes === 'number' && Number.isSafeInteger(meta.changes)
    ? meta.changes : null
}

async function transitionQuote(
  request: Request, env: QuoteAdminServiceEnv, reference: string, actor: QuoteAdmin,
): Promise<Response> {
  if (actor.role === 'viewer') return response(403, { error: 'forbidden' })
  const input = await parseTransition(request)
  if (!input) return response(400, { error: 'invalid_transition_request' })
  if (!canTransitionQuote(input.expectedStatus, input.toStatus, actor.role)) {
    return response(409, { error: 'invalid_transition' })
  }
  const quote = await findQuote(env, reference)
  if (!quote) return response(404, { error: 'quote_not_found' })
  if (quote.status !== input.expectedStatus || quote.revision !== input.expectedRevision) {
    return response(409, { error: 'stale_quote' })
  }
  try {
    // Both revision and state are checked again in D1 at write time. The R25
    // BEFORE INSERT trigger is the ultimate atomic compare-and-swap guard.
    const result = await env.DB.prepare(ADMIN_INSERT_EVENT_SQL).bind(
      input.expectedStatus, input.toStatus,
      actor.subject, actor.email, actor.role, input.responseText,
      quote.id, quote.reference, input.expectedRevision,
    ).run()
    const count = dbChanges(result)
    if (count === 0) return response(409, { error: 'stale_quote' })
    if (count !== 1) return response(503, { error: 'transition_unconfirmed' })
  } catch (error) {
    if (error instanceof Error && /quote_status_stale|quote_transition_forbidden/i.test(error.message)) {
      return response(409, { error: 'stale_quote' })
    }
    return response(503, { error: 'transition_unavailable' })
  }
  const updated = await findQuote(env, reference)
  if (!updated || updated.status !== input.toStatus) {
    return response(503, { error: 'transition_unconfirmed' })
  }
  return response(200, {
    reference: updated.reference, status: updated.status, revision: updated.revision,
    responseDelivered: false,
  })
}

/**
 * Ready for isolated tests and later explicit protected-origin registration.
 * An unconfigured or unenabled installation responds 404 BEFORE accessing D1,
 * JWKS or a customer record. No CORS or cookie-based session is supported.
 */
export async function handleQuoteAdminRequest(
  request: Request,
  env: QuoteAdminServiceEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (env.QUOTE_ADMIN_ROUTE_ENABLED !== 'true') {
    return response(404, { error: 'not_found' })
  }
  const url = new URL(request.url)
  if (url.pathname !== '/api/admin/quotes' && !/^\/api\/admin\/quotes\/[^/]+(?:\/transitions)?$/.test(url.pathname)) {
    return response(404, { error: 'not_found' })
  }
  if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) {
    return response(403, { error: 'origin_not_allowed' })
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return response(405, { error: 'method_not_allowed' })
  }
  const actor = await authenticateQuoteAdminRequest(request, env, fetcher)
  if (!actor || !canReadQuote(actor.role)) {
    return response(401, { error: 'unauthorized' })
  }
  try {
    if (url.pathname === '/api/admin/quotes' && request.method === 'GET') {
      return await listQuotes(request, env)
    }
    const match = url.pathname.match(/^\/api\/admin\/quotes\/([^/]+?)(\/transitions)?$/)
    if (!match || !REF.test(match[1]) || url.search) {
      return response(400, { error: 'invalid_quote_reference' })
    }
    if (match[2] && request.method === 'POST') {
      return await transitionQuote(request, env, match[1], actor)
    }
    if (!match[2] && request.method === 'GET') {
      return await detailQuote(env, match[1])
    }
    return response(405, { error: 'method_not_allowed' })
  } catch {
    return response(503, { error: 'quote_admin_unavailable' })
  }
}
