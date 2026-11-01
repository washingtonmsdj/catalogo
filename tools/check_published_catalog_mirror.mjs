/**
 * Fail-closed deployment smoke for the existing Pages -> Vercel rewrite.
 * Reads two public HTML entries and one hashed JS asset HEAD only.
 * Never queries catalog API, D1, R2 or media.
 */
import { pathToFileURL } from 'node:url'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 3_000
const REQUEST_TIMEOUT_MS = 12_000
const ENTRY_SCRIPT = /^index-[A-Za-z0-9_-]+\.js$/

function entryUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.search || url.hash || !url.pathname.endsWith('/')) {
    throw new Error('catalog_mirror_entry_url_invalid')
  }
  return url
}

export function catalogEntryScript(html, pageUrl) {
  const entry = entryUrl(pageUrl)
  const assetPrefix = new URL('./assets/', entry)
  const matches = []

  for (const tag of String(html).matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*(?:"module"|'module'|module)(?=\s|>)/i.test(tag[0])) continue
    const src = tag[0].match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    if (!src) continue
    const scriptUrl = new URL(src[1] ?? src[2] ?? src[3], entry)
    if (scriptUrl.origin !== entry.origin || !scriptUrl.pathname.startsWith(assetPrefix.pathname)) {
      throw new Error('catalog_mirror_script_origin_invalid')
    }
    const filename = scriptUrl.pathname.slice(assetPrefix.pathname.length)
    if (!ENTRY_SCRIPT.test(filename) || scriptUrl.search || scriptUrl.hash) {
      throw new Error('catalog_mirror_script_name_invalid')
    }
    matches.push({ filename, url: scriptUrl.href })
  }

  if (matches.length !== 1) throw new Error('catalog_mirror_entry_script_count:' + matches.length)
  return matches[0]
}

export function compareCatalogEntryScripts(pagesHtml, pagesUrl, vercelHtml, vercelUrl) {
  const pages = catalogEntryScript(pagesHtml, pagesUrl)
  const vercel = catalogEntryScript(vercelHtml, vercelUrl)
  if (pages.filename !== vercel.filename) {
    throw new Error('catalog_mirror_bundle_mismatch:pages=' + pages.filename + ';vercel=' + vercel.filename)
  }
  return vercel
}

async function request(url, { method = 'GET', fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    redirect: 'follow',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('catalog_mirror_http_' + response.status + ':' + method + ':' + url)
  return response
}

export async function verifyPublishedCatalogMirror({
  pagesUrl, vercelUrl, fetchImpl = fetch, attempts = MAX_ATTEMPTS,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const pages = entryUrl(pagesUrl)
  const vercel = entryUrl(vercelUrl)
  if (vercel.hostname !== 'acheguese.vercel.app') {
    throw new Error('catalog_mirror_unexpected_vercel_host')
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
    throw new Error('catalog_mirror_invalid_attempt_count')
  }
  const pagesHtml = await (await request(pages.href, { fetchImpl })).text()
  const pagesEntry = catalogEntryScript(pagesHtml, pages.href)

  let error
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const vercelHtml = await (await request(vercel.href, { fetchImpl })).text()
      const asset = compareCatalogEntryScripts(pagesHtml, pages.href, vercelHtml, vercel.href)
      const response = await request(asset.url, { method: 'HEAD', fetchImpl })
      const contentType = response.headers.get('content-type') ?? ''
      if (!/(?:javascript|ecmascript)/i.test(contentType)) {
        throw new Error('catalog_mirror_asset_type_invalid:' + (contentType || 'missing'))
      }
      return { filename: pagesEntry.filename, verifiedUrl: asset.url, attempts: attempt }
    } catch (cause) {
      error = cause
      if (attempt < attempts) await delay(RETRY_DELAY_MS)
    }
  }
  throw error
}

async function main() {
  const result = await verifyPublishedCatalogMirror({
    pagesUrl: process.env.PAGE_URL,
    vercelUrl: process.env.VERCEL_CATALOG_URL,
  })
  console.log('Catalog mirror verified: ' + result.filename + ' (' + result.attempts + ' attempt(s))')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
