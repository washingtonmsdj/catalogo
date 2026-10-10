#!/usr/bin/env node
import { verifyWorkerGalleryContract } from './check_worker_gallery_contract.mjs'
import { verifyWorkerHealth } from './check_worker_health.mjs'
import { versionOverrideHeaderValue } from './cloudflare_deploy_state.mjs'
import { canonicalWorkerName, loadWranglerConfig } from './wrangler_config_contract.mjs'

export function fetchWithVersionOverride(fetchImpl, overrideValue) {
  return (url, init = {}) => {
    const headers = new Headers(init.headers ?? {})
    headers.set('Cloudflare-Workers-Version-Overrides', overrideValue)
    return fetchImpl(url, { ...init, headers })
  }
}

export async function verifyStagedWorkerVersion({ apiBase, versionId, fetchImpl = fetch } = {}) {
  const base = String(apiBase ?? '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('API base must be http(s)')

  const config = await loadWranglerConfig()
  const workerName = canonicalWorkerName(config)
  const overrideValue = versionOverrideHeaderValue(workerName, versionId)
  const stagedFetch = fetchWithVersionOverride(fetchImpl, overrideValue)

  const health = await verifyWorkerHealth(base, stagedFetch)
  const gallery = await verifyWorkerGalleryContract(base, stagedFetch)
  return {
    ok: true,
    workerName,
    versionId,
    health,
    gallery,
  }
}

async function main() {
  const apiBase = process.argv[2] || process.env.CATALOG_API_URL || process.env.VITE_API_BASE_URL
  const versionId = process.argv[3] || process.env.STAGED_WORKER_VERSION_ID
  if (!apiBase) throw new Error('API base is required')
  if (!versionId) throw new Error('STAGED_WORKER_VERSION_ID is required')
  process.stdout.write(JSON.stringify(await verifyStagedWorkerVersion({ apiBase, versionId })) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}
