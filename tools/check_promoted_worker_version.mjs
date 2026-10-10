#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises'
import { runBoundedRetry } from './bounded_retry.mjs'
import { assertWorkerVersionId, fetchActiveProductionVersion } from './cloudflare_deploy_state.mjs'
import { verifyWorkerReleaseContract } from './worker_release_smoke.mjs'

const DEFAULT_CONTROL_ATTEMPTS = 10
const DEFAULT_CONTROL_DELAY_MS = 1_000
const DEFAULT_RELEASE_ATTEMPTS = 8
const DEFAULT_RELEASE_DELAY_MS = 1_000

export async function verifyPromotedWorkerVersion({
  apiBase,
  versionId,
  fetchActiveVersion = fetchActiveProductionVersion,
  verifyRelease = verifyWorkerReleaseContract,
  sleepImpl = sleep,
  controlAttempts = DEFAULT_CONTROL_ATTEMPTS,
  controlDelayMs = DEFAULT_CONTROL_DELAY_MS,
  releaseAttempts = DEFAULT_RELEASE_ATTEMPTS,
  releaseDelayMs = DEFAULT_RELEASE_DELAY_MS,
} = {}) {
  const expectedVersionId = assertWorkerVersionId(versionId, 'Promoted Worker version ID')
  const base = String(apiBase ?? '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('API base must be http(s)')

  const activeVersion = await runBoundedRetry(
    async () => {
      const active = await fetchActiveVersion()
      if (active !== expectedVersionId) {
        throw new Error(`active deployment is ${active}, expected ${expectedVersionId}`)
      }
      return active
    },
    {
      attempts: controlAttempts,
      delayMs: controlDelayMs,
      sleepImpl,
      onRetry: ({ attempt, attempts, delayMs, error }) => {
        console.error(
          `Promoted Worker control-plane attempt ${attempt}/${attempts} failed: ${error instanceof Error ? error.message : String(error)}. Retrying after ${delayMs}ms.`,
        )
      },
    },
  )

  const release = await runBoundedRetry(
    () => verifyRelease(base),
    {
      attempts: releaseAttempts,
      delayMs: releaseDelayMs,
      sleepImpl,
      onRetry: ({ attempt, attempts, delayMs, error }) => {
        console.error(
          `Promoted Worker public release attempt ${attempt}/${attempts} failed: ${error instanceof Error ? error.message : String(error)}. Retrying after ${delayMs}ms.`,
        )
      },
    },
  )

  return {
    ...release,
    versionId: expectedVersionId,
    activeVersion,
  }
}

async function main() {
  const apiBase = process.argv[2] || process.env.CATALOG_API_URL || process.env.VITE_API_BASE_URL
  const versionId = process.argv[3] || process.env.STAGED_WORKER_VERSION_ID
  if (!apiBase) throw new Error('API base is required')
  if (!versionId) throw new Error('STAGED_WORKER_VERSION_ID is required')
  process.stdout.write(JSON.stringify(await verifyPromotedWorkerVersion({ apiBase, versionId })) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}
