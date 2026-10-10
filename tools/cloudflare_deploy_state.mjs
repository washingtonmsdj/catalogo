#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { canonicalWorkerName, loadWranglerConfig } from './wrangler_config_contract.mjs'

const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assertWorkerVersionId(value, label = 'Worker version ID') {
  const versionId = String(value ?? '').trim()
  if (!VERSION_ID_PATTERN.test(versionId)) {
    throw new Error(`${label} must be a canonical UUID`)
  }
  return versionId
}

export function activeVersionIdFromDeployments(payload) {
  const deployments = payload?.result?.deployments ?? payload?.deployments
  if (!Array.isArray(deployments) || deployments.length < 1) {
    throw new Error('Cloudflare returned no Worker deployments')
  }

  const current = deployments[0]
  if (!Array.isArray(current?.versions) || current.versions.length !== 1) {
    throw new Error('Current production deployment must contain exactly one Worker version')
  }

  const entry = current.versions[0]
  if (Number(entry?.percentage) !== 100) {
    throw new Error('Current production deployment must route 100% to one Worker version')
  }
  return assertWorkerVersionId(entry?.version_id, 'Current production Worker version ID')
}

export function uploadedVersionIdFromWranglerNdjson(text) {
  const events = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Wrangler output line ${index + 1} is not valid JSON`, { cause: error })
      }
    })

  const uploads = events.filter((entry) => entry?.type === 'version-upload')
  if (uploads.length !== 1) {
    throw new Error(`Expected exactly one version-upload event; found ${uploads.length}`)
  }
  return assertWorkerVersionId(uploads[0]?.version_id, 'Staged Worker version ID')
}

export function versionOverrideHeaderValue(workerName, versionId) {
  const name = String(workerName ?? '').trim()
  if (!name) throw new Error('Worker name is required for version override')
  return `${name}="${assertWorkerVersionId(versionId)}"`
}

export async function fetchActiveProductionVersion({ accountId, apiToken, fetchImpl = fetch } = {}) {
  const resolvedAccountId = String(accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()
  const resolvedToken = String(apiToken ?? process.env.CLOUDFLARE_API_TOKEN ?? '').trim()
  if (!resolvedAccountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required')
  if (!resolvedToken) throw new Error('CLOUDFLARE_API_TOKEN is required')

  const config = await loadWranglerConfig()
  const workerName = canonicalWorkerName(config)
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(resolvedAccountId)}/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
    {
      headers: {
        authorization: `Bearer ${resolvedToken}`,
        accept: 'application/json',
        'user-agent': 'tonecos-catalog-deploy-state/1',
      },
    },
  )
  if (!response?.ok) {
    throw new Error(`Cloudflare deployments request failed with HTTP ${response?.status ?? 'unknown'}`)
  }
  const payload = await response.json()
  if (payload?.success !== true) throw new Error('Cloudflare deployments response reported success=false')
  return activeVersionIdFromDeployments(payload)
}

async function main() {
  const command = process.argv[2]
  if (command === 'active-version') {
    process.stdout.write(`${await fetchActiveProductionVersion()}\n`)
    return
  }
  if (command === 'uploaded-version') {
    const filePath = process.argv[3]
    if (!filePath) throw new Error('Wrangler output file path is required')
    process.stdout.write(`${uploadedVersionIdFromWranglerNdjson(await readFile(filePath, 'utf8'))}\n`)
    return
  }
  throw new Error('Usage: cloudflare_deploy_state.mjs active-version | uploaded-version <wrangler-output.ndjson>')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}
