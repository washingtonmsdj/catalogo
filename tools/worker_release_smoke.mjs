import { verifyWorkerGalleryContract } from './check_worker_gallery_contract.mjs'
import { verifyWorkerHealth } from './check_worker_health.mjs'

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'tonecos-catalog-release-smoke/1',
    },
  })
  if (!response?.ok) throw new Error(`${label} failed with HTTP ${response?.status ?? 'unknown'}`)
  return response.json()
}

/**
 * Verify the real published cover with HEAD (no Range) and a one-byte Range.
 * Reuses the exact cover key already fetched by the gallery smoke. No new D1
 * query, full media download or mutation. Applies to both 0% and live smoke.
 */
export async function verifyWorkerCoverHttpContract(apiBase, coverStorageKey, fetchImpl = fetch) {
  const base = String(apiBase ?? '').trim().replace(/\/$/, '')
  if (!/^https:\/\/[^\s]+$/.test(base) ||
    typeof coverStorageKey !== 'string' ||
    !coverStorageKey.startsWith('media/') ||
    coverStorageKey.length > 1024 ||
    coverStorageKey.includes('\\') ||
    coverStorageKey.includes('?') || coverStorageKey.includes('#') ||
    coverStorageKey.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('published cover smoke requires canonical media key and HTTPS API base')
  }
  const url = base + '/' + coverStorageKey.split('/').map(encodeURIComponent).join('/')
  const head = await fetchImpl(url, {
    method: 'HEAD',
    redirect: 'error',
    headers: { accept: 'image/*', 'user-agent': 'tonecos-cover-release-smoke/1' },
    signal: AbortSignal.timeout(12000),
  })
  if (head?.status !== 200 || head.headers?.has('content-range') ||
    !/^image\/(?:webp|png|jpeg|avif)(?:;|$)/i.test(head.headers?.get('content-type') ?? '')) {
    throw new Error(`published cover HEAD without Range expected HTTP 200 and image content, got HTTP ${head?.status ?? 'unknown'}`)
  }
  const totalSize = Number(head.headers.get('content-length'))
  if (!Number.isSafeInteger(totalSize) || totalSize < 1) {
    throw new Error('published cover HEAD returned invalid content length')
  }

  const range = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    headers: {
      range: 'bytes=0-0',
      accept: 'image/*',
      'user-agent': 'tonecos-cover-release-smoke/1',
    },
    signal: AbortSignal.timeout(12000),
  })
  try {
    if (range?.status !== 206 ||
      range.headers?.get('content-range') !== `bytes 0-0/${totalSize}` ||
      range.headers?.get('content-length') !== '1') {
      throw new Error(`published cover one-byte Range expected HTTP 206, got HTTP ${range?.status ?? 'unknown'}`)
    }
    return { ok: true, headStatus: 200, rangeStatus: 206 }
  } finally {
    // Headers establish the contract; cancel the streamed body immediately.
    // Never consume a full R2 object during deployment checks.
    await range?.body?.cancel().catch(() => undefined)
  }
}

export async function verifyWorkerReleaseContract(apiBase, fetchImpl = fetch) {
  const base = String(apiBase ?? '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('API base must be http(s)')

  const health = await verifyWorkerHealth(base, fetchImpl)

  const categories = await fetchJson(fetchImpl, `${base}/api/categories`, 'categories probe')
  if (!Array.isArray(categories?.items)) throw new Error('categories probe returned an invalid payload')

  const recent = await fetchJson(fetchImpl, `${base}/api/recent?limit=1`, 'recent probe')
  if (!Array.isArray(recent?.items) || recent.items.length < 1 || !recent.items[0]?.slug) {
    throw new Error('recent probe returned no published model')
  }

  const gallery = await verifyWorkerGalleryContract(base, fetchImpl)
  const media = await verifyWorkerCoverHttpContract(base, gallery.coverStorageKey, fetchImpl)

  const shared = await fetchImpl(`${base}/api/shared-collections/TCL-AAAAAAAAAAAAAAAA`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'tonecos-catalog-release-smoke/1',
    },
  })
  if (shared?.status !== 404) {
    throw new Error(`shared collections probe expected HTTP 404, got ${shared?.status ?? 'unknown'}`)
  }
  const sharedPayload = await shared.json()
  if (sharedPayload?.error !== 'shared_collection_not_found') {
    throw new Error('shared collections probe returned an unexpected error contract')
  }

  return {
    ok: true,
    health,
    categories: categories.items.length,
    recent: recent.items.length,
    gallery,
    media,
    sharedCollections: true,
  }
}

/**
 * Negative-only quote ingress probe. Sends invalid empty JSON, never a customer
 * identity, model ID, Turnstile token or valid quote. The server must reject
 * before the D1 mutation path. Call only after the public health probe passes.
 */
export async function verifyPublicQuoteIngress(
  apiBase,
  fetchImpl = fetch,
) {
  const base = 'https://acheguese.vercel.app/catalogo-api'
  if (apiBase !== base) throw new Error('quote ingress must use canonical first-party Vercel proxy')
  const response = await fetchImpl(base + '/api/quotes', {
    method: 'POST',
    redirect: 'error',
    headers: {
      origin: 'https://acheguese.vercel.app',
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(12000),
  })
  if (response.status !== 400) {
    throw new Error('quote ingress unexpected status ' + response.status)
  }
  const payload = await response.json().catch(() => null)
  if (payload?.error !== 'invalid_request') {
    throw new Error('quote ingress did not reject invalid input before Turnstile or D1 writes')
  }
  const cors = response.headers.get('access-control-allow-origin')
  if (cors && cors !== 'https://acheguese.vercel.app') {
    throw new Error('quote ingress returned unexpected CORS origin')
  }
  return { ok: true, invalidQuoteRejected: true, productionWrites: 0 }
}
