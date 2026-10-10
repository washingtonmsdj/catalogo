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
    sharedCollections: true,
  }
}
