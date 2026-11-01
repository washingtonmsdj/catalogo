import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configuredPublicOrigins, verifiedTurnstileResponse, validateTurnstile,
} from '../worker/turnstile.ts'

const origins = [
  'https://washingtonmsdj.github.io',
  'https://acheguese.com.br',
  'https://www.acheguese.com.br',
  'https://acheguese.vercel.app',
].join(',')
const valid = { success: true, action: 'quote', hostname: 'acheguese.vercel.app' }

test('Turnstile uses the exact public CORS SSOT, not a second hostname allowlist', () => {
  assert.equal(configuredPublicOrigins(origins).length, 4)
  assert.equal(verifiedTurnstileResponse(valid, origins, 'https://acheguese.vercel.app', 'quote'), true)
  assert.equal(verifiedTurnstileResponse({ ...valid, hostname: 'acheguese.com.br' }, origins, 'https://acheguese.com.br', 'quote'), true)
  assert.equal(verifiedTurnstileResponse({ ...valid, hostname: 'washingtonmsdj.github.io' }, origins, null, 'quote'), true)
})

test('siteverify fails closed on missing hostname, spoofed host or wrong form action', () => {
  const wrong = [
    null,
    {},
    { success: false, action: 'quote', hostname: 'acheguese.vercel.app' },
    { ...valid, hostname: undefined },
    { ...valid, hostname: '' },
    { ...valid, hostname: 'untrusted.vercel.app' },
    { ...valid, hostname: 'acheguese.vercel.app.attacker.test' },
    { ...valid, action: 'collection-share' },
  ]
  for (const payload of wrong) {
    assert.equal(verifiedTurnstileResponse(payload, origins, 'https://acheguese.vercel.app', 'quote'), false)
  }
  assert.equal(verifiedTurnstileResponse(valid, origins, 'https://acheguese.com.br', 'quote'), false)
  assert.equal(verifiedTurnstileResponse(valid, origins, 'https://untrusted.test', 'quote'), false)
  assert.equal(verifiedTurnstileResponse(valid, origins, null, 'quote'), true)
  assert.equal(verifiedTurnstileResponse(
    { ...valid, action: 'collection-share' }, origins, 'https://acheguese.vercel.app', 'collection-share',
  ), true)
})

test('insecure and wildcard CORS entries never authorize a hostname', () => {
  assert.equal(verifiedTurnstileResponse(valid, 'http://acheguese.vercel.app', null, 'quote'), false)
  assert.equal(verifiedTurnstileResponse(valid, 'https://*.vercel.app', null, 'quote'), false)
  assert.equal(verifiedTurnstileResponse(valid, 'https://acheguese.vercel.app/', null, 'quote'), false)
})

test('Siteverify validates token, action and hostname without touching D1', async () => {
  const calls = []
  const request = new Request('https://worker.example/api/quotes', {
    method: 'POST', headers: { origin: 'https://acheguese.vercel.app', 'CF-Connecting-IP': '192.0.2.1' },
  })
  const env = { CORS_ORIGINS: origins, TURNSTILE_SECRET_KEY: 'synthetic-test-secret' }
  const fakeFetch = async (url, options) => {
    calls.push({ url, options })
    return Response.json(valid)
  }
  assert.equal(await validateTurnstile(request, env, 'synthetic-token', 'quote', fakeFetch), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.body.get('response'), 'synthetic-token')
  assert.equal(calls[0].options.body.get('secret'), 'synthetic-test-secret')
  assert.equal(calls[0].options.body.get('remoteip'), '192.0.2.1')
  assert.match(calls[0].options.body.get('idempotency_key'), /^[0-9a-f-]{36}$/)
})

test('all invalid token and siteverify failure cases fail closed', async () => {
  const request = new Request('https://worker.example/api/quotes', {
    method: 'POST', headers: { origin: 'https://acheguese.vercel.app' },
  })
  const env = { CORS_ORIGINS: origins, TURNSTILE_SECRET_KEY: 'synthetic-test-secret' }
  const shouldNotFetch = async () => { throw Error('unexpected Siteverify request') }
  assert.equal(await validateTurnstile(request, env, '', 'quote', shouldNotFetch), false)
  assert.equal(await validateTurnstile(request, env, 'x'.repeat(2049), 'quote', shouldNotFetch), false)
  assert.equal(await validateTurnstile(request, { ...env, TURNSTILE_SECRET_KEY: '' }, 'valid', 'quote', shouldNotFetch), false)
  assert.equal(await validateTurnstile(request, env, 'token', 'quote', async () => new Response(null, { status: 503 })), false)
  assert.equal(await validateTurnstile(request, env, 'token', 'quote', async () => { throw Error('network failure') }), false)
  assert.equal(await validateTurnstile(request, env, 'token', 'quote', async () =>
    Response.json({ ...valid, hostname: 'wrong.example' })), false)
})
