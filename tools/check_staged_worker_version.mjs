#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises'
import { verifyWorkerGalleryContract } from './check_worker_gallery_contract.mjs'
import { verifyWorkerHealth } from './check_worker_health.mjs'
import { versionOverrideHeaderValue } from './cloudflare_deploy_state.mjs'
import { canonicalWorkerName, loadWranglerConfig } from './wrangler_config_contract.mjs'

const DEFAULT_ATTEMPTS = 5
const DEFAULT_DELAY_MS = 2_000

export function fetchWithVersionOverride(fetchImpl, overrideValue) {
  return (url, init = {}) => {
    const headers = new Headers(init.headers ?? {})
    headers.set('Cloudflare-Workers-Version-Overrides', overrideValue)
    return fetchImpl(url, { ...init, headers })
  }
}

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'tonecos-catalog-staged-smoke/1',
    },
  })
  if (!response?.ok) throw new Error(`${label} failed with HTTP ${response?.status ?? 'unknown'}`)
  return response.json()
}

export async function verifyStagedWorkerVersion({ apiBase, versionId, fetchImpl = fetch } = {}) {
  const base = String(apiBase ?? '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('API base must be http(s)')

  const config = await loadWranglerConfig()
  const workerName = canonicalWorkerName(config)
  const overrideValue = versionOverrideHeaderValue(workerName, versionId)
  const stagedFetch = fetchWithVersionOverride(fetchImpl, overrideValue)

  const health = await verifyWorkerHealth(base, stagedFetch)

  const categories = await fetchJson(stagedFetch, `${base}/api/categories`, 'categories probe')
  if (!Array.isArray(categories?.items)) throw new Error('categories probe returned an invalid payload')

  const recent = await fetchJson(stagedFetch, `${base}/api/recent?limit=1`, 'recent probe')
  if (!Array.isArray(recent?.items) || recent.items.length < 1 || !recent.items[0]?.slug) {
    throw new Error('recent probe returned no published model')
  }

  const gallery = await verifyWorkerGalleryContract(base, stagedFetch)

  const shared = await stagedFetch(`${base}/api/shared-collections/TCL-AAAAAAAAAAAAAAAA`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'tonecos-catalog-staged-smoke/1',
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
    workerName,
    versionId,
    health,
    categories: categories.items.length,
    recent: recent.items.length,
    gallery,
    sharedCollections: true,
  }
}

export async function runBoundedRetry(operation, {
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  sleepImpl = sleep,
  onRetry = () => {},
} = {}) {
  if (typeof operation !== 'function') throw new Error('operation must be a function')
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error('attempts must be an integer between 1 and 10')
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 30_000) {
    throw new Error('delayMs must be an integer between 0 and 30000')
  }

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      onRetry({ attempt, attempts, delayMs, error })
      await sleepImpl(delayMs)
    }
  }

  throw new Error(
    `Operation failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError instanceof Error ? lastError : undefined },
  )
}

export async function verifyStagedWorkerVersionWithRetry({
  apiBase,
  versionId,
  fetchImpl = fetch,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  sleepImpl = sleep,
} = {}) {
  try {
    return await runBoundedRetry(
      () => verifyStagedWorkerVersion({ apiBase, versionId, fetchImpl }),
      {
        attempts,
        delayMs,
        sleepImpl,
        onRetry: ({ attempt, attempts: total, delayMs: delay, error }) => {
          console.error(
            `Staged Worker smoke attempt ${attempt}/${total} failed: ${error instanceof Error ? error.message : String(error)}. Retrying after ${delay}ms.`,
          )
        },
      },
    )
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
    throw new Error(
      `Staged Worker smoke failed after ${attempts} attempts: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: cause instanceof Error ? cause : undefined },
    )
  }
}

async function main() {
  const apiBase = process.argv[2] || process.env.CATALOG_API_URL || process.env.VITE_API_BASE_URL
  const versionId = process.argv[3] || process.env.STAGED_WORKER_VERSION_ID
  if (!apiBase) throw new Error('API base is required')
  if (!versionId) throw new Error('STAGED_WORKER_VERSION_ID is required')
  process.stdout.write(JSON.stringify(await verifyStagedWorkerVersionWithRetry({ apiBase, versionId })) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}
