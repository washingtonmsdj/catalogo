import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogEntryScript, compareCatalogEntryScripts, verifyPublishedCatalogMirror } from './check_published_catalog_mirror.mjs'

const pagesUrl = 'https://washingtonmsdj.github.io/catalogo/'
const vercelUrl = 'https://acheguese.vercel.app/tonecosstudios/'
const html = (asset) => '<!doctype html><script type="module" crossorigin src="./assets/' + asset + '"></script>'

test('Vite release fingerprint remains identical after Vercel rewrite', () => {
  const expected = 'index-BjaTZw0E.js'
  const result = compareCatalogEntryScripts(html(expected), pagesUrl, html(expected), vercelUrl)
  assert.equal(result.filename, expected)
  assert.equal(result.url, vercelUrl + 'assets/' + expected)
})

test('stale mirrored HTML is rejected rather than changing CSP or using direct Worker URLs', () => {
  assert.throws(
    () => compareCatalogEntryScripts(html('index-BjaTZw0E.js'), pagesUrl, html('index-tXe1BWGL.js'), vercelUrl),
    /catalog_mirror_bundle_mismatch/,
  )
})

test('module entry must exist exactly once and be same-origin in its own route', () => {
  assert.throws(() => catalogEntryScript('<html></html>', vercelUrl), /catalog_mirror_entry_script_count:0/)
  assert.throws(() => catalogEntryScript(html('index-a.js') + html('index-b.js'), vercelUrl), /catalog_mirror_entry_script_count:2/)
  assert.throws(() => catalogEntryScript('<script type="module" src="https://invalid.example/assets/index-a.js"></script>', vercelUrl), /catalog_mirror_script_origin_invalid/)
  assert.throws(() => catalogEntryScript('<script type="module" src="./assets/catalog.js"></script>', vercelUrl), /catalog_mirror_script_name_invalid/)
})

test('bounded network smoke fetches only HTML entries and one same-origin Vercel asset HEAD', async () => {
  const requested = []
  const fetchImpl = async (url, init) => {
    requested.push(init.method + ':' + url)
    if (url === pagesUrl) return new Response(html('index-a123.js'), { status: 200 })
    if (url === vercelUrl) return new Response(html('index-a123.js'), { status: 200 })
    if (url === vercelUrl + 'assets/index-a123.js') return new Response(null, { status: 200, headers: { 'content-type': 'application/javascript' } })
    throw new Error('unexpected_network_request')
  }
  const result = await verifyPublishedCatalogMirror({ pagesUrl, vercelUrl, fetchImpl, delay: async () => {} })
  assert.equal(result.filename, 'index-a123.js')
  assert.deepEqual(requested, [
    'GET:' + pagesUrl,
    'GET:' + vercelUrl,
    'HEAD:' + vercelUrl + 'assets/index-a123.js',
  ])
})

test('a stale first response can converge within a strict three-attempt limit', async () => {
  let vercelReads = 0
  const fetchImpl = async (url) => {
    if (url === pagesUrl) return new Response(html('index-new.js'))
    if (url === vercelUrl) return new Response(html(++vercelReads < 2 ? 'index-old.js' : 'index-new.js'))
    return new Response(null, { headers: { 'content-type': 'text/javascript' } })
  }
  const result = await verifyPublishedCatalogMirror({ pagesUrl, vercelUrl, fetchImpl, delay: async () => {} })
  assert.equal(result.attempts, 2)
  assert.equal(vercelReads, 2)
})

test('a missing/HTML asset is rejected instead of declaring a successful deployment', async () => {
  const fetchImpl = async (url) => url === pagesUrl || url === vercelUrl
    ? new Response(html('index-a123.js'))
    : new Response(null, { headers: { 'content-type': 'text/html' } })
  await assert.rejects(
    verifyPublishedCatalogMirror({ pagesUrl, vercelUrl, fetchImpl, attempts: 1 }),
    /catalog_mirror_asset_type_invalid/,
  )
})
