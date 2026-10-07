import schemaContract from '../config/catalog-schema-contract.json' with { type: 'json' }

export type SchemaDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results: T[] }>
    }
  }
}

export type SchemaStatus = {
  ready: boolean
  contractVersion: number
  latestMigration: string
  requiredMigrations: number
  appliedMigrations: number
  missingMigrations: string[]
}

let readyCache: Promise<SchemaStatus> | null = null

async function readSchemaStatus(db: SchemaDatabase): Promise<SchemaStatus> {
  const required = schemaContract.requiredMigrations
  const placeholders = required.map(() => '?').join(',')
  const result = await db.prepare(
    `SELECT name FROM d1_migrations WHERE name IN (${placeholders}) ORDER BY name`,
  ).bind(...required).all<{ name: string }>()

  const applied = new Set(result.results.map((row) => row.name))
  const missing = required.filter((name) => !applied.has(name))
  return {
    ready: missing.length === 0,
    contractVersion: schemaContract.version,
    latestMigration: schemaContract.latestMigration,
    requiredMigrations: required.length,
    appliedMigrations: required.length - missing.length,
    missingMigrations: missing,
  }
}

export async function catalogSchemaStatus(db: SchemaDatabase): Promise<SchemaStatus> {
  if (readyCache) return readyCache
  try {
    const pending = readSchemaStatus(db)
    const status = await pending
    if (status.ready) {
      readyCache = Promise.resolve(status)
    }
    return status
  } catch {
    return {
      ready: false,
      contractVersion: schemaContract.version,
      latestMigration: schemaContract.latestMigration,
      requiredMigrations: schemaContract.requiredMigrations.length,
      appliedMigrations: 0,
      missingMigrations: [...schemaContract.requiredMigrations],
    }
  }
}

export function resetSchemaStatusCacheForTests() {
  readyCache = null
}
