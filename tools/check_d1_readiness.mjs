#!/usr/bin/env node
/**
 * One read-only D1 quota/baseline probe before producing a Worker version.
 * It does not replace the full schema audit or staged release smoke.
 */
import { readFileSync } from 'node:fs'
import { canonicalD1DatabaseId, loadWranglerConfig } from './wrangler_config_contract.mjs'

const contract = JSON.parse(readFileSync(new URL('../config/catalog-schema-contract.json', import.meta.url), 'utf8'))
const baselineMigration = contract.requiredMigrations[0]
const DATABASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACCOUNT_ID = /^[0-9a-f]{32}$/i

export class D1ReadinessError extends Error {
  constructor(code) { super(code); this.name = 'D1ReadinessError'; this.code = code }
}

export function validateD1ProbeResponse(status, payload, baseline = baselineMigration) {
  const apiErrors = Array.isArray(payload?.errors) ? payload.errors : []
  const first = Array.isArray(payload?.result) ? payload.result[0] : null
  const nestedErrors = Array.isArray(first?.errors) ? first.errors : []
  if ([...apiErrors, ...nestedErrors].some(err => Number(err?.code) === 7500)) {
    throw new D1ReadinessError('d1_daily_read_quota_exceeded')
  }
  if (status < 200 || status > 299 || payload?.success !== true || first?.success !== true) {
    throw new D1ReadinessError('d1_probe_unavailable')
  }
  if (!Array.isArray(first.results) || first.results.length !== 1 || first.results[0]?.name !== baseline) {
    throw new D1ReadinessError('d1_schema_baseline_not_confirmed')
  }
  return { ready: true, baseline }
}

export async function verifyD1Readiness({
  accountId, databaseId, token, fetchImpl = fetch, timeoutMs = 10000,
} = {}) {
  if (!ACCOUNT_ID.test(accountId ?? '') || !DATABASE_ID.test(databaseId ?? '') || !token) {
    throw new D1ReadinessError('d1_probe_configuration_invalid')
  }
  let reply
  try {
    reply = await fetchImpl(
      'https://api.cloudflare.com/client/v4/accounts/' + accountId +
        '/d1/database/' + databaseId + '/query',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          accept: 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify({
          sql: 'SELECT name FROM d1_migrations WHERE name = ? LIMIT 1',
          params: [baselineMigration],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
  } catch {
    throw new D1ReadinessError('d1_probe_network_unavailable')
  }
  let payload
  try { payload = await reply.json() }
  catch { throw new D1ReadinessError('d1_probe_invalid_response') }
  return validateD1ProbeResponse(reply.status, payload)
}

async function main() {
  const config = await loadWranglerConfig()
  const canonicalId = canonicalD1DatabaseId(config)
  if (process.env.CLOUDFLARE_D1_DATABASE_ID !== canonicalId) {
    throw new D1ReadinessError('d1_probe_binding_drift')
  }
  const result = await verifyD1Readiness({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    databaseId: canonicalId,
    token: process.env.CLOUDFLARE_API_TOKEN,
  })
  process.stdout.write(JSON.stringify(result) + '\n')
}

if (import.meta.url === 'file://' + process.argv[1]) {
  main().catch(error => {
    console.error('D1 preflight blocked: ' + (error instanceof D1ReadinessError ? error.code : 'd1_probe_unavailable'))
    process.exitCode = 2
  })
}
