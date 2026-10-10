import { loadWranglerConfig, canonicalD1DatabaseId, canonicalWorkerName } from './wrangler_config_contract.mjs'

function sorted(values) {
  return [...values].sort()
}

function bindingByName(bindings, name) {
  const matches = bindings.filter((binding) => binding?.name === name)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one remote binding named ${name}; found ${matches.length}`)
  }
  return matches[0]
}

export function expectedRemoteWorkerConfig(config) {
  const workerName = canonicalWorkerName(config)
  const d1Id = canonicalD1DatabaseId(config)
  const cors = String(config?.vars?.CORS_ORIGINS ?? '').trim()
  if (!cors) throw new Error('wrangler.jsonc must declare vars.CORS_ORIGINS')

  const r2 = Array.isArray(config?.r2_buckets)
    ? config.r2_buckets.filter((entry) => entry?.binding === 'MEDIA')
    : []
  if (r2.length !== 1 || !String(r2[0]?.bucket_name ?? '').trim()) {
    throw new Error('wrangler.jsonc must declare exactly one MEDIA R2 binding')
  }

  const requiredSecrets = config?.secrets?.required
  if (!Array.isArray(requiredSecrets) || requiredSecrets.length !== 1 || requiredSecrets[0] !== 'TURNSTILE_SECRET_KEY') {
    throw new Error('wrangler.jsonc must require only TURNSTILE_SECRET_KEY')
  }

  return {
    workerName,
    compatibilityDate: String(config?.compatibility_date ?? ''),
    compatibilityFlags: sorted(config?.compatibility_flags ?? []),
    observabilityEnabled: Boolean(config?.observability?.enabled),
    cors,
    d1Id,
    r2Bucket: String(r2[0].bucket_name),
    requiredBindingNames: sorted(['CORS_ORIGINS', 'DB', 'MEDIA', 'TURNSTILE_SECRET_KEY']),
  }
}

export function assertRemoteWorkerConfig(expected, remote) {
  if (!remote || typeof remote !== 'object') throw new Error('Cloudflare Worker settings response is invalid')
  if (remote.compatibility_date !== expected.compatibilityDate) {
    throw new Error(`Remote compatibility_date drift: expected ${expected.compatibilityDate}, found ${remote.compatibility_date ?? '<missing>'}`)
  }
  const remoteFlags = sorted(remote.compatibility_flags ?? [])
  if (JSON.stringify(remoteFlags) !== JSON.stringify(expected.compatibilityFlags)) {
    throw new Error(`Remote compatibility_flags drift: expected ${JSON.stringify(expected.compatibilityFlags)}, found ${JSON.stringify(remoteFlags)}`)
  }
  if (Boolean(remote?.observability?.enabled) !== expected.observabilityEnabled) {
    throw new Error(`Remote observability drift: expected enabled=${expected.observabilityEnabled}`)
  }

  const bindings = Array.isArray(remote.bindings) ? remote.bindings : []
  const names = sorted(bindings.map((binding) => binding?.name).filter(Boolean))
  if (JSON.stringify(names) !== JSON.stringify(expected.requiredBindingNames)) {
    throw new Error(`Remote binding set drift: expected ${JSON.stringify(expected.requiredBindingNames)}, found ${JSON.stringify(names)}`)
  }

  const cors = bindingByName(bindings, 'CORS_ORIGINS')
  if (cors.type !== 'plain_text' || cors.text !== expected.cors) {
    throw new Error('Remote CORS_ORIGINS drift')
  }

  const db = bindingByName(bindings, 'DB')
  const remoteD1Id = String(db.database_id ?? db.id ?? '')
  if (db.type !== 'd1' || remoteD1Id !== expected.d1Id) {
    throw new Error(`Remote DB binding drift: expected ${expected.d1Id}, found ${remoteD1Id || '<missing>'}`)
  }

  const media = bindingByName(bindings, 'MEDIA')
  if (media.type !== 'r2_bucket' || media.bucket_name !== expected.r2Bucket) {
    throw new Error(`Remote MEDIA binding drift: expected ${expected.r2Bucket}`)
  }

  const secret = bindingByName(bindings, 'TURNSTILE_SECRET_KEY')
  if (!['secret_text', 'secret_key'].includes(secret.type)) {
    throw new Error(`Remote TURNSTILE_SECRET_KEY binding has unexpected type ${secret.type ?? '<missing>'}`)
  }
}

export async function fetchRemoteWorkerSettings({ accountId, apiToken, workerName, fetchImpl = fetch }) {
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required')
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required')
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/settings`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.success || !payload?.result) {
    const detail = payload?.errors?.map((error) => `${error.code ?? 'unknown'}:${error.message ?? 'unknown error'}`).join(', ')
    throw new Error(`Unable to read remote Worker settings (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  return payload.result
}

async function main() {
  const config = await loadWranglerConfig()
  const expected = expectedRemoteWorkerConfig(config)
  const remote = await fetchRemoteWorkerSettings({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    workerName: expected.workerName,
  })
  assertRemoteWorkerConfig(expected, remote)
  console.log(`Remote Worker config matches canonical SSOT for ${expected.workerName}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
