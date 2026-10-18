import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { handleQuoteAdminRequest } from '../worker/quoteAdminApi.ts'

const issuer = 'https://r26-test.cloudflareaccess.com'
const audience = 'app-quote-private'
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = rsa.publicKey.export({ format: 'jwk' })
const jwks = { keys: [{ kid: 'rsa-r26', kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e }] }
const fetcher = async () => Response.json(jwks)
const ref = 'TCS-ABCD-1234-ABCD-1234-ABCD'
const ref2 = 'TCS-ABCD-1234-ABCD-1234-EEEE'
const host = 'https://private.example.com'

function signed(email = 'owner@example.com', changes = {}) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { iss: issuer, aud: audience, sub: 'access-user-id',
    email, exp: now + 300, iat: now - 5, nbf: now - 5, ...changes }
  const base64 = x => Buffer.from(JSON.stringify(x)).toString('base64url')
  const data = base64({ alg: 'RS256', kid: 'rsa-r26', typ: 'JWT' }) + '.' + base64(payload)
  return data + '.' + sign('RSA-SHA256', Buffer.from(data), rsa.privateKey).toString('base64url')
}
function config(db, enabled = 'true') {
  return { DB: db, QUOTE_ADMIN_ROUTE_ENABLED: enabled,
    QUOTE_ADMIN_ACCESS_ISSUER: issuer, QUOTE_ADMIN_ACCESS_AUDIENCE: audience,
    QUOTE_ADMIN_ALLOWED_PRINCIPALS: JSON.stringify([
      { email: 'owner@example.com', role: 'owner' },
      { email: 'viewer@example.com', role: 'viewer' },
    ]) }
}
function req(path, { method = 'GET', body, token = signed(), origin, contentType } = {}) {
  const headers = { 'Cf-Access-Jwt-Assertion': token }
  if (origin) headers.origin = origin
  if (contentType) headers['content-type'] = contentType
  return new Request(host + path, { method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function send(store, path, opt = {}, enabled = 'true') {
  const res = await handleQuoteAdminRequest(req(path, opt), config(store.db, enabled), fetcher)
  return { status: res.status, data: await res.json(), headers: res.headers }
}
function memoryDb() {
  const quotes = [
    { id: 'q1', reference: ref, name: 'Cliente A', email: 'a@example.com',
      notes: 'Azul', created_at: '2026-10-16 12:00:00', status: 'new' },
    { id: 'q2', reference: ref2, name: 'Cliente B', email: 'b@example.com',
      notes: null, created_at: '2026-10-15 12:00:00', status: 'new' },
  ]
  const events = []
  let queries = 0
  let writes = 0
  let broken = false
  function current(quote) {
    if (!quote) return null
    const latest = events.filter(e => e.quote_request_id === quote.id).at(-1)
    return { ...quote, status: latest?.to_status || quote.status, revision: latest?.id || 0 }
  }
  const db = {
    prepare(sql) {
      queries++
      let args = []
      return {
        bind(...values) { args = values; return this },
        async first() {
          if (broken) throw Error('private DB down')
          if (sql.includes('FROM quote_requests q WHERE q.reference=?')) {
            return current(quotes.find(q => q.reference === args[0]))
          }
          throw Error('unknown first SQL: ' + sql)
        },
        async all() {
          if (broken) throw Error('private DB down')
          if (sql.includes('ORDER BY q.created_at DESC,q.id DESC LIMIT ?')) {
            const [cursor, , , cursorId, limit] = args
            return { results: quotes
              .filter(q => cursor === null || q.created_at < cursor ||
                (q.created_at === cursor && q.id < cursorId))
              .sort((a, b) => (b.created_at + b.id).localeCompare(a.created_at + a.id))
              .slice(0, limit)
              .map(q => ({ ...current(q), item_count: 2 })) }
          }
          if (sql.includes('FROM quote_request_items item')) return {
            results: [{ code: 'TS-001', name: 'Modelo 3D', quantity: 1 }],
          }
          if (sql.includes('FROM quote_status_events WHERE quote_request_id=?')) {
            return { results: events.filter(e => e.quote_request_id === args[0]) }
          }
          throw Error('unknown all SQL: ' + sql)
        },
        async run() {
          if (broken) throw Error('private DB down')
          if (!sql.includes('INSERT INTO quote_status_events')) throw Error('unknown mutation')
          writes++
          const [from, to, subject, email, role, responseText, id, reference, rev] = args
          const target = quotes.find(q => q.id === id && q.reference === reference)
          if (!target || current(target).revision !== rev) return { meta: { changes: 0 } }
          if (current(target).status !== from) throw Error('quote_status_stale')
          events.push({ id: events.length + 1, quote_request_id: id,
            from_status: from, to_status: to, actor_subject: subject,
            actor_email: email, actor_role: role, response_text: responseText,
            created_at: '2026-10-17 10:00:00' })
          return { meta: { changes: 1 } }
        },
      }
    },
  }
  return { db, events,
    get queries() { return queries },
    get writes() { return writes },
    breakDb() { broken = true } }
}

test('admin service is unmounted and fail-closed without explicit gate', async () => {
  const store = memoryDb()
  const res = await handleQuoteAdminRequest(req('/api/admin/quotes'),
    config(store.db, ''), async () => { throw Error('unwanted JWKS request') })
  assert.equal(res.status, 404)
  assert.equal(store.queries, 0)
  assert.equal(res.headers.get('access-control-allow-origin'), null)
  const index = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')
  const entry = readFileSync(new URL('../worker/entry.ts', import.meta.url), 'utf8')
  assert.ok(!index.includes('quoteAdminApi') && !entry.includes('quoteAdminApi'))
  assert.ok(!index.includes('/api/admin/quotes'))
  assert.ok(index.includes("status: 'received'"))
})

test('JWT signature/expiry/audience/allowlist are mandatory before any DB read', async () => {
  const store = memoryDb()
  for (const token of ['', 'invalid', signed('other@example.com'),
    signed('owner@example.com', { exp: 1 }),
    signed('owner@example.com', { aud: 'other-app' })]) {
    const res = await send(store, '/api/admin/quotes/' + ref, { token })
    assert.equal(res.status, 401)
  }
  assert.equal(store.queries, 0)
  assert.equal((await send(store, '/api/admin/quotes',
    { origin: 'https://attacker.example' })).status, 403)
  assert.equal(store.queries, 0)
})

test('keyset pagination is bounded, with no customer PII or internal IDs in listing', async () => {
  const store = memoryDb()
  const first = await send(store, '/api/admin/quotes?limit=1')
  assert.equal(first.status, 200)
  assert.equal(first.data.items[0].reference, ref)
  assert.equal(first.data.items[0].revision, 0)
  assert.ok(first.data.nextCursor)
  assert.ok(!JSON.stringify(first.data.items).includes('@example.com'))
  assert.ok(!JSON.stringify(first.data.items).includes('q1'))
  const second = await send(store, '/api/admin/quotes?limit=1&cursor=' + first.data.nextCursor)
  assert.equal(second.data.items[0].reference, ref2)
  assert.equal(second.data.nextCursor, null)
  for (const query of ['?limit=0', '?limit=26', '?cursor=!', '?offset=1', '?limit=1&limit=2']) {
    assert.equal((await send(store, '/api/admin/quotes' + query)).status, 400)
  }
  assert.equal(first.headers.get('cache-control'), 'private, no-store, max-age=0')
})

test('viewer reads PII in detail but cannot mutate', async () => {
  const store = memoryDb()
  const detail = await send(store, '/api/admin/quotes/' + ref, { token: signed('viewer@example.com') })
  assert.equal(detail.status, 200)
  assert.equal(detail.data.email, 'a@example.com')
  assert.equal(detail.data.items[0].name, 'Modelo 3D')
  assert.equal(detail.data.history.length, 0)
  const denied = await send(store, '/api/admin/quotes/' + ref + '/transitions', {
    token: signed('viewer@example.com'), method: 'POST', contentType: 'application/json',
    body: { expectedStatus: 'new', expectedRevision: 0, toStatus: 'in_review' },
  })
  assert.equal(denied.status, 403)
  assert.equal(store.writes, 0)
})

test('owner mutations follow canonical states, actor audit and optimistic revisions', async () => {
  const store = memoryDb()
  const path = '/api/admin/quotes/' + ref + '/transitions'
  const post = body => send(store, path, {
    method: 'POST', contentType: 'application/json', body,
  })
  const first = await post({ expectedStatus: 'new', expectedRevision: 0, toStatus: 'in_review' })
  assert.equal(first.status, 200)
  assert.equal(first.data.revision, 1)
  assert.equal(first.data.responseDelivered, false)
  assert.equal(store.events[0].actor_subject, 'access-user-id')
  assert.equal(store.events[0].actor_email, 'owner@example.com')
  assert.equal((await post({ expectedStatus: 'new', expectedRevision: 0, toStatus: 'in_review' })).status, 409)
  assert.equal((await post({ expectedStatus: 'in_review', expectedRevision: 1,
    toStatus: 'response_recorded' })).status, 400)
  assert.equal((await post({ expectedStatus: 'in_review', expectedRevision: 1,
    toStatus: 'new' })).status, 409)
  const recorded = await post({ expectedStatus: 'in_review', expectedRevision: 1,
    toStatus: 'response_recorded', responseText: '  resposta interna  ' })
  assert.equal(recorded.status, 200)
  assert.equal(store.events[1].response_text, 'resposta interna')
  const closed = await post({ expectedStatus: 'response_recorded', expectedRevision: 2,
    toStatus: 'closed' })
  assert.equal(closed.data.status, 'closed')
  assert.equal((await send(store, '/api/admin/quotes/' + ref)).data.history.length, 3)
  assert.equal(store.events.length, 3)
})

test('invalid input, missing quote, and database failures never leak customer data', async () => {
  const store = memoryDb()
  assert.equal((await send(store, '/api/admin/quotes/TCS-1111-2222-3333-4444-5555')).status, 404)
  const bad = await send(store, '/api/admin/quotes/' + ref + '/transitions', {
    method: 'POST', contentType: 'application/json',
    body: { expectedStatus: 'new', expectedRevision: 0,
      toStatus: 'in_review', responseText: 'unexpected' },
  })
  assert.equal(bad.status, 400)
  store.breakDb()
  const failure = await send(store, '/api/admin/quotes/' + ref)
  assert.equal(failure.status, 503)
  assert.ok(!JSON.stringify(failure.data).includes('a@example.com'))
})
