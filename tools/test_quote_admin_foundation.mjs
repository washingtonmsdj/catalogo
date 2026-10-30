import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  accessIssuer, quoteAdminPrincipals,
  verifyQuoteAdminAssertion, authenticateQuoteAdminRequest,
} from '../worker/quoteAdminAccess.ts'
import {
  QUOTE_STATUSES, QUOTE_TRANSITIONS, canReadQuote, canTransitionQuote,
} from '../worker/quoteWorkflow.ts'

const issuer = 'https://catalog-test.cloudflareaccess.com'
const audience = 'audience-for-isolated-tests'
const now = Math.floor(Date.now()/1000)
const keysPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = keysPair.publicKey.export({format:'jwk'})
const jwks = {keys:[{kid:'test-kid',kty:'RSA',alg:'RS256',n:jwk.n,e:jwk.e}]}
const principals = [
  {email:'owner@example.com',role:'owner'},
  {email:'sales@example.com',role:'operator'},
  {email:'reader@example.com',role:'viewer'},
]
function token(overrides={},headerOverrides={}) {
  const h = {alg:'RS256',kid:'test-kid',typ:'JWT',...headerOverrides}
  const payload = {
    iss:issuer,aud:[audience],sub:'verified-subject',
    email:'owner@example.com',exp:now+300,iat:now-15,nbf:now-15,...overrides,
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const content = encode(h)+'.'+encode(payload)
  return content+'.'+sign('RSA-SHA256',Buffer.from(content),keysPair.privateKey).toString('base64url')
}

test('canonical quote workflow: explicit transitions and immutable closed state', () => {
  assert.deepEqual(QUOTE_STATUSES,['new','in_review','response_recorded','closed'])
  for(const s of QUOTE_STATUSES) assert.ok(Object.hasOwn(QUOTE_TRANSITIONS,s))
  assert.equal(canReadQuote('viewer'),true)
  assert.equal(canTransitionQuote('new','in_review','owner'),true)
  assert.equal(canTransitionQuote('in_review','response_recorded','operator'),true)
  assert.equal(canTransitionQuote('response_recorded','closed','operator'),true)
  assert.equal(canTransitionQuote('in_review','closed','owner'),true)
  assert.equal(canTransitionQuote('new','closed','owner'),false)
  assert.equal(canTransitionQuote('closed','in_review','owner'),false)
  assert.equal(canTransitionQuote('new','in_review','viewer'),false)
  assert.equal(canTransitionQuote('new','in_review','admin'),false)
  assert.equal(canTransitionQuote('new','unknown','owner'),false)
})

test('server-defined allowlist denies duplicates, unauthorized roles and missing owner', () => {
  const parsed = quoteAdminPrincipals('[{"email":" OWNER@example.com ","role":"owner"}]')
  assert.deepEqual(parsed,[{email:'owner@example.com',role:'owner'}])
  assert.equal(quoteAdminPrincipals('[{"email":"reader@example.com","role":"viewer"}]'),null)
  assert.equal(quoteAdminPrincipals('[{"email":"owner@example.com","role":"admin"}]'),null)
  assert.equal(quoteAdminPrincipals('[{"email":"owner@example.com","role":"owner"},{"email":"OWNER@example.com","role":"operator"}]'),null)
  assert.equal(quoteAdminPrincipals('not-json'),null)
  assert.equal(quoteAdminPrincipals(undefined),null)
})

test('issuer must be a strict HTTPS Cloudflare Access team origin', () => {
  assert.equal(accessIssuer(issuer),issuer)
  for(const value of ['http://catalog-test.cloudflareaccess.com',
    'https://catalog-test.cloudflareaccess.com/admin',
    'https://catalog-test.cloudflareaccess.com@evil.example',
    'https://example.com','https://cloudflareaccess.com']) {
    assert.equal(accessIssuer(value),null)
  }
})

test('valid signed JWT grants exactly the server allowlist role', async () => {
  const result = await verifyQuoteAdminAssertion(token({
    email:'SALES@example.com',role:'owner',
  }),issuer,audience,principals,jwks,now)
  assert.deepEqual(result,{subject:'verified-subject',email:'sales@example.com',role:'operator'})
})

test('forgery, expiry, wrong issuer/audience, missing user and algorithm confusion deny', async () => {
  const invalid=[
    token({iss:'https://evil.cloudflareaccess.com'}),
    token({aud:['another-app']}),
    token({exp:now-1}),
    token({nbf:now+120}),
    token({iat:now+120}),
    token({email:'intruder@example.com'}),
    token({sub:''}),
    token({}, {alg:'none'}),
    token({}, {kid:'missing'}),
  ]
  const valid=token()
  const sections=valid.split('.')
  invalid.push(sections[0]+'.'+Buffer.from('{"email":"owner@example.com"}').toString('base64url')+'.'+sections[2])
  for(const assertion of invalid)
    assert.equal(await verifyQuoteAdminAssertion(assertion,issuer,audience,principals,jwks,now),null)
  assert.equal(await verifyQuoteAdminAssertion(valid,issuer,audience,principals,{keys:[]},now),null)
  assert.equal(await verifyQuoteAdminAssertion('not-a-jwt',issuer,audience,principals,jwks,now),null)
})

test('absent admin config denies before contacting JWKS', async () => {
  let calls=0
  const fetcher=async()=>{ calls++; throw Error('unexpected network call') }
  const request=new Request('https://shop.example/api/admin/quotes',
    {headers:{'Cf-Access-Jwt-Assertion':token()}})
  assert.equal(await authenticateQuoteAdminRequest(request,{},fetcher),null)
  assert.equal(await authenticateQuoteAdminRequest(request,{
    QUOTE_ADMIN_ACCESS_ISSUER:issuer,
    QUOTE_ADMIN_ACCESS_AUDIENCE:audience,
    QUOTE_ADMIN_ALLOWED_PRINCIPALS:'',
  },fetcher),null)
  assert.equal(calls,0)
})

test('authenticated request verifies real RS256 JWT against JWKS before identity release', async () => {
  let calls=0
  const fetcher=async()=>{calls++;return Response.json(jwks)}
  const settings={
    QUOTE_ADMIN_ACCESS_ISSUER:issuer,
    QUOTE_ADMIN_ACCESS_AUDIENCE:audience,
    QUOTE_ADMIN_ALLOWED_PRINCIPALS:JSON.stringify(principals),
  }
  const request=new Request('https://shop.example/api/admin/quotes',
    {headers:{'Cf-Access-Jwt-Assertion':token()}})
  assert.deepEqual(await authenticateQuoteAdminRequest(request,settings,fetcher),
    {subject:'verified-subject',email:'owner@example.com',role:'owner'})
  assert.equal(calls,1)
  assert.equal(await authenticateQuoteAdminRequest(new Request(request.url),settings,fetcher),null)
  assert.equal(calls,1)
})

test('R25 does not register any admin route or change the customer-facing received status', () => {
  const source=readFileSync(new URL('../worker/index.ts',import.meta.url),'utf8')
  assert.equal(source.includes('/api/admin/quotes'),false)
  assert.equal(source.includes("status: 'received'"),true)
})
