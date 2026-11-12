import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { validatePublicCatalogQuery } from '../worker/publicQueryBudget.ts'

const ORIGIN = 'https://tonecos-catalogo-api.example.workers.dev'
const query = (path) => validatePublicCatalogQuery(new URL(path, ORIGIN))

test('catalog Worker rejects cache-key flooding before D1 schema checks', () => {
  const invalid = [
    '/api/catalog?limit=12&extra=cache-bust',
    '/api/catalog?limit=12&limit=12',
    '/api/catalog?limit=000012',
    '/api/catalog?limit=61',
    '/api/catalog?cursor=invalid%25cursor',
    '/api/catalog?q=ab',
    '/api/catalog?q=' + 'x'.repeat(121),
    '/api/catalog?material=' + 'x'.repeat(121),
    '/api/catalog?minHeight=0',
    '/api/catalog?category=with%2Fslash',
    '/api/recent?cursor=Ng%3D%3D',
    '/api/recent?limit=25',
    '/api/categories?offset=0',
    '/api/health?nonce=123',
    '/api/franchises?category=filmes&limit=49',
    '/api/folders?category=filmes&franchise=classicos&parent=..',
    '/api/models/modelo-teste?noCache=1',
    '/api/models/modelo-teste/images?limit=6&v=1&cursor=wrong%25',
    '/api/models/modelo-teste/images?version=1',
    '/api/models/INVALID?limit=1',
    '/media/mdl-ordinary/image/card.webp?cache_bust=random',
    '/media/mdl-ordinary/image/card.webp?x=1&x=2',
  ]
  for (const path of invalid) assert.equal(query(path), false, path)
})

test('all canonical public catalog request variants remain accepted', () => {
  const allowed = [
    '/api/catalog',
    '/api/catalog?limit=12',
    '/api/catalog?category=filmes&franchise=classicos&folder=colecao%2Fpersonagens&limit=12',
    '/api/catalog?category=all&q=Boneco%20Raro&limit=12',
    '/api/catalog?material=Resina&collection=Especial&minHeight=10&maxHeight=120',
    '/api/catalog?limit=12&cursor=eyJuYW1lIjoiQm9uZWNvIiwiaWQiOiJtb2RlbG8ifQ',
    '/api/categories',
    '/api/franchises?category=filmes&q=Boneco&limit=24',
    '/api/folders?category=filmes&franchise=classicos&parent=colecao%2Fpersonagens',
    '/api/recent?limit=12',
    '/api/models/modelo-teste',
    '/api/models/modelo-teste/images?limit=6&v=1&cursor=Ng%3D%3D',
    '/api/health',
    '/media/mdl-ordinary/image/card.webp',
  ]
  for (const path of allowed) assert.equal(query(path), true, path)
})

test('non-catalog routes remain under the existing quote and shared-collection authority', () => {
  for (const path of [
    '/api/quotes',
    '/api/quotes?test=1',
    '/api/shared-collections',
    '/api/shared-collections/TCL-AAAAAAAAAAAAAAAA',
    '/api/shared-collections/TCL-AAAAAAAAAAAAAAAA?token=some-token',
  ]) assert.equal(query(path), null, path)
})

test('D1 and R2 handlers reject cache-busting requests before storage access', () => {
  const index = fs.readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')
  const entry = fs.readFileSync(new URL('../worker/entry.ts', import.meta.url), 'utf8')
  const d1Guard = index.indexOf('validatePublicCatalogQuery(url) === false')
  const schemaCheck = index.indexOf('const schema = await catalogSchemaStatus(env.DB)')
  assert.ok(d1Guard >= 0 && schemaCheck > d1Guard)
  assert.ok(index.includes("error: 'invalid_catalog_query'"))
  assert.ok(index.includes("status: 400"))
  const mediaGuard = entry.indexOf('validatePublicCatalogQuery(url) === false')
  const mediaRead = entry.indexOf('return servePublicMedia(request, env.MEDIA')
  assert.ok(mediaGuard >= 0 && mediaRead > mediaGuard)
  assert.ok(entry.includes("'cache-control': 'no-store'"))
})

test('absurd query size is blocked without a D1 query or additional cache', () => {
  const path = '/api/catalog?q=' + 'a'.repeat(4096)
  assert.equal(query(path), false)
})
