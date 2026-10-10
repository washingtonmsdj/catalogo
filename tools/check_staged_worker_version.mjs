#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises'
import { runBoundedRetry } from './bounded_retry.mjs'
import { versionOverrideHeaderValue } from './cloudflare_deploy_state.mjs'
import { canonicalWorkerName, loadWranglerConfig } from './wrangler_config_contract.mjs'
import { verifyWorkerReleaseContract } from './worker_release_smoke.mjs'

const DEFAULT_ATTEMPTS = 5
const DEFAULT_DELAY_MS = 2_000

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
  const release = await verifyWorkerReleaseContract(base, stagedFetch)

  return {
    ...release,
    workerName,
    versionId,
  }
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
