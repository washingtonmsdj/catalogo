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
  requiredStructures: number
  verifiedStructures: number
  missingStructures: string[]
  /** Present only when verification was impossible, not when objects are missing. */
  errorCode?: 'd1_daily_read_quota_exceeded' | 'schema_query_unavailable'
}

type SchemaObjectType = 'table' | 'index' | 'trigger'

// A complete schema audit is expensive on D1. The first concurrent requests
// share one in-flight audit; successful verification remains isolate-cached.
// Failures are NEVER treated as healthy and are retried after a short cooldown.
// This bounds schema reads during an outage without hiding recovery indefinitely.
export const FAILED_SCHEMA_RECHECK_MS = 30_000

let statusCache: Promise<SchemaStatus> | null = null
let recheckAt = 0

function requiredStructureKeys() {
  const keys: string[] = []
  for (const type of ['tables', 'indexes', 'triggers'] as const) {
    const sqliteType: SchemaObjectType = type === 'tables' ? 'table' : type === 'indexes' ? 'index' : 'trigger'
    for (const name of schemaContract.requiredObjects[type]) keys.push(`${sqliteType}:${name}`)
  }
  for (const [table, columns] of Object.entries(schemaContract.requiredObjects.columns)) {
    for (const column of columns) keys.push(`column:${table}.${column}`)
  }
  return keys
}

async function structuralStatus(db: SchemaDatabase) {
  const requiredKeys = requiredStructureKeys()
  const found = new Set<string>()

  const objectPairs: Array<[SchemaObjectType, string]> = []
  for (const type of ['tables', 'indexes', 'triggers'] as const) {
    const sqliteType: SchemaObjectType = type === 'tables' ? 'table' : type === 'indexes' ? 'index' : 'trigger'
    for (const name of schemaContract.requiredObjects[type]) objectPairs.push([sqliteType, name])
  }

  if (objectPairs.length) {
    const where = objectPairs.map(() => '(type=? AND name=?)').join(' OR ')
    const values = objectPairs.flatMap(([type, name]) => [type, name])
    const result = await db.prepare(
      `SELECT type,name FROM sqlite_schema WHERE ${where}`,
    ).bind(...values).all<{ type: string; name: string }>()
    for (const row of result.results) found.add(`${row.type}:${row.name}`)
  }

  for (const [table, columns] of Object.entries(schemaContract.requiredObjects.columns)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`invalid schema contract table name: ${table}`)
    }
    const placeholders = columns.map(() => '?').join(',')
    const result = await db.prepare(
      `SELECT name FROM pragma_table_info('${table}') WHERE name IN (${placeholders})`,
    ).bind(...columns).all<{ name: string }>()
    for (const row of result.results) found.add(`column:${table}.${row.name}`)
  }

  const missingStructures = requiredKeys.filter((key) => !found.has(key))
  return {
    requiredStructures: requiredKeys.length,
    verifiedStructures: requiredKeys.length - missingStructures.length,
    missingStructures,
  }
}

async function readSchemaStatus(db: SchemaDatabase): Promise<SchemaStatus> {
  const required = schemaContract.requiredMigrations
  const placeholders = required.map(() => '?').join(',')
  const result = await db.prepare(
    `SELECT name FROM d1_migrations WHERE name IN (${placeholders}) ORDER BY name`,
  ).bind(...required).all<{ name: string }>()

  const applied = new Set(result.results.map((row) => row.name))
  const missingMigrations = required.filter((name) => !applied.has(name))
  if (missingMigrations.length) {
    const requiredStructures = requiredStructureKeys()
    return {
      ready: false,
      contractVersion: schemaContract.version,
      latestMigration: schemaContract.latestMigration,
      requiredMigrations: required.length,
      appliedMigrations: required.length - missingMigrations.length,
      missingMigrations,
      requiredStructures: requiredStructures.length,
      verifiedStructures: 0,
      missingStructures: requiredStructures,
    }
  }

  const structures = await structuralStatus(db)
  return {
    ready: structures.missingStructures.length === 0,
    contractVersion: schemaContract.version,
    latestMigration: schemaContract.latestMigration,
    requiredMigrations: required.length,
    appliedMigrations: required.length,
    missingMigrations: [],
    ...structures,
  }
}

function unavailableStatus(error: unknown): SchemaStatus {
  const message = error instanceof Error ? error.message : ''
  const quota = /\b7500\b|d1.{0,80}(?:row.read|read.limit|daily.quota)|daily.{0,80}row.read|exceeded.{0,80}row.read/i.test(message)

  const structures = requiredStructureKeys()
  return {
    ready: false,
    contractVersion: schemaContract.version,
    latestMigration: schemaContract.latestMigration,
    requiredMigrations: schemaContract.requiredMigrations.length,
    appliedMigrations: 0,
    // A rejected query cannot prove that migrations are missing.
    missingMigrations: [],
    requiredStructures: structures.length,
    verifiedStructures: 0,
    // A rejected query cannot prove that schema objects are missing.
    missingStructures: [],
    errorCode: quota ? 'd1_daily_read_quota_exceeded' : 'schema_query_unavailable',
  }
}

export function catalogSchemaStatus(db: SchemaDatabase): Promise<SchemaStatus> {
  // Infinity represents both a pending validation and a healthy isolate.
  // The promise is assigned synchronously, so cold-start concurrency shares
  // the same audit rather than multiplying expensive D1 metadata reads.
  if (statusCache && (recheckAt === Infinity || Date.now() < recheckAt)) {
    return statusCache
  }

  recheckAt = Infinity
  statusCache = readSchemaStatus(db)
    .catch(unavailableStatus)
    .then(status => {
      recheckAt = status.ready ? Infinity : Date.now() + FAILED_SCHEMA_RECHECK_MS
      return status
    })

  return statusCache
}

export function resetSchemaStatusCacheForTests() {
  statusCache = null
  recheckAt = 0
}
