import { readFile } from 'node:fs/promises'

export const WRANGLER_SOURCE_URL = new URL('../wrangler.jsonc', import.meta.url)
export const CANONICAL_D1_BINDING = 'DB'

const D1_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WORKER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export async function loadWranglerConfig(sourceUrl = WRANGLER_SOURCE_URL) {
  const raw = await readFile(sourceUrl, 'utf8')
  let config
  try {
    config = JSON.parse(raw)
  } catch (error) {
    throw new Error(`wrangler.jsonc is not valid JSON: ${error.message}`, { cause: error })
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('wrangler.jsonc must contain one configuration object')
  }
  return config
}

export function canonicalWorkerName(config) {
  const name = String(config?.name ?? '').trim()
  if (!WORKER_NAME_PATTERN.test(name)) {
    throw new Error('wrangler.jsonc must declare one canonical lowercase Worker name')
  }
  return name
}

export function canonicalD1DatabaseId(config, binding = CANONICAL_D1_BINDING) {
  if (!Array.isArray(config?.d1_databases)) {
    throw new Error('wrangler.jsonc must declare d1_databases')
  }

  const matches = config.d1_databases.filter((entry) => entry?.binding === binding)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one D1 binding named ${binding}; found ${matches.length}`)
  }

  const databaseId = String(matches[0]?.database_id ?? '').trim()
  if (!D1_UUID_PATTERN.test(databaseId)) {
    throw new Error(`D1 binding ${binding} must contain a canonical Cloudflare database UUID`)
  }
  return databaseId
}
