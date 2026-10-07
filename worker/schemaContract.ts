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
}

type SchemaObjectType = 'table' | 'index' | 'trigger'

let readyCache: Promise<SchemaStatus> | null = null

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

function unavailableStatus(): SchemaStatus {
  const structures = requiredStructureKeys()
  return {
    ready: false,
    contractVersion: schemaContract.version,
    latestMigration: schemaContract.latestMigration,
    requiredMigrations: schemaContract.requiredMigrations.length,
    appliedMigrations: 0,
    missingMigrations: [...schemaContract.requiredMigrations],
    requiredStructures: structures.length,
    verifiedStructures: 0,
    missingStructures: structures,
  }
}

export async function catalogSchemaStatus(db: SchemaDatabase): Promise<SchemaStatus> {
  if (readyCache) return readyCache
  try {
    const status = await readSchemaStatus(db)
    if (status.ready) readyCache = Promise.resolve(status)
    return status
  } catch {
    return unavailableStatus()
  }
}

export function resetSchemaStatusCacheForTests() {
  readyCache = null
}
