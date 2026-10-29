import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog-schema-contract.json'), 'utf8'))
const migrationDirectory = path.join(root, 'migrations')
const bundled = await esbuild.build({
  entryPoints: [path.join(root, 'worker/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  write: false,
})
const worker = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const CATALOG_MODEL_COUNT = 20_320
const PAGE_SIZE = 48

function createCatalogDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);')
  const migrationInsert = db.prepare('INSERT INTO d1_migrations(name) VALUES(?)')
  for (const name of contract.requiredMigrations) {
    db.exec(fs.readFileSync(path.join(migrationDirectory, name), 'utf8'))
    migrationInsert.run(name)
  }

  db.prepare("INSERT INTO categories(id,slug,name) VALUES(1,'games','Games')").run()
  db.prepare("INSERT INTO franchises(id,category_id,slug,name) VALUES(1,1,'saga-alfa','Saga Alfa')").run()

  const insert = db.prepare(`INSERT INTO models(
    id,franchise_id,slug,code,name,variant_name,collection,material,height_cm,
    description,image_count,cover_storage_key,gallery_manifest_key,gallery_version,
    public_gallery_version,published,search_text
  ) VALUES(?,1,?,?,?,?,?,?,?,'Fixture local de paginação em escala.',1,?, ?,1,1,1,?)`)
  db.exec('BEGIN')
  for (let index = 1; index <= CATALOG_MODEL_COUNT; index += 1) {
    const suffix = String(index).padStart(5, '0')
    const collection = index % 3 === 0 ? 'Coleção B' : 'Coleção A'
    const material = index % 2 === 0 ? 'PVC' : 'Resina'
    const height = 20 + (index % 61)
    insert.run(
      `model-${suffix}`, `model-${suffix}`, `R29-${suffix}`, `Modelo escalável ${suffix}`, '',
      collection, material, height, `test-media/${suffix}/card.webp`,
      `test-media/${suffix}/manifest.json`, `pokémon modelo escalável ${suffix} ${collection} ${material}`,
    )
  }
  db.exec('COMMIT')
  return db
}

function createD1Adapter(db) {
  const catalogStatements = []
  const database = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        bind(...values) {
          return {
            async all() {
              if (sql.includes('SELECT m.id,m.slug,m.code,m.name')) catalogStatements.push({ sql, values })
              return { results: statement.all(...values) }
            },
            async first() { return statement.get(...values) ?? null },
            async run() { return statement.run(...values) },
          }
        },
      }
    },
    async batch(statements) {
      return statements.map((statement) => statement.run())
    },
  }
  return { database, catalogStatements }
}

async function requestCatalog(database, params) {
  const url = new URL('https://catalog.example.test/api/catalog')
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await worker.default.fetch(new Request(url), {
    DB: database,
    MEDIA: { get: async () => null },
    CORS_ORIGINS: '',
  })
  return { response, body: await response.json() }
}

test('D1 Worker SQL keyset pages and filters a 20k live catalog over a full migrated SQLite schema', async (context) => {
  const db = createCatalogDatabase()
  context.after(() => db.close())
  const { database, catalogStatements } = createD1Adapter(db)

  const first = await requestCatalog(database, {
    category: 'games', franchise: 'saga-alfa', limit: PAGE_SIZE,
  })
  assert.equal(first.response.status, 200)
  assert.equal(first.body.items.length, PAGE_SIZE)
  assert.equal(first.body.items[0].code, 'R29-00001')
  assert.ok(first.body.nextCursor)
  const firstCodes = first.body.items.map((item) => item.code)
  const firstStatement = catalogStatements.at(-1)
  const firstPlan = db.prepare(`EXPLAIN QUERY PLAN ${firstStatement.sql}`).all(...firstStatement.values)
  assert.ok(firstPlan.some((row) => row.detail.includes('idx_models_franchise_published_name_id')),
    `Expected the franchise/name keyset index; plan: ${firstPlan.map((row) => row.detail).join(' | ')}`)

  const second = await requestCatalog(database, {
    category: 'games', franchise: 'saga-alfa', limit: PAGE_SIZE, cursor: first.body.nextCursor,
  })
  assert.equal(second.response.status, 200)
  assert.equal(second.body.items.length, PAGE_SIZE)
  assert.equal(second.body.items[0].code, 'R29-00049')
  const secondCodes = second.body.items.map((item) => item.code)
  assert.equal(firstCodes.some((code) => secondCodes.includes(code)), false)

  const filtered = await requestCatalog(database, {
    category: 'games', franchise: 'saga-alfa', material: 'PVC', collection: 'Coleção B',
    minHeight: 30, maxHeight: 60, limit: PAGE_SIZE,
  })
  assert.equal(filtered.response.status, 200)
  assert.equal(filtered.body.items.length, PAGE_SIZE)
  assert.ok(filtered.body.items.every((item) => item.material === 'PVC'
    && item.collection === 'Coleção B' && item.height_cm >= 30 && item.height_cm <= 60))
  const filteredNext = await requestCatalog(database, {
    category: 'games', franchise: 'saga-alfa', material: 'PVC', collection: 'Coleção B',
    minHeight: 30, maxHeight: 60, limit: PAGE_SIZE, cursor: filtered.body.nextCursor,
  })
  assert.equal(filteredNext.response.status, 200)
  assert.equal(filtered.body.items.some((item) => filteredNext.body.items.some((next) => next.id === item.id)), false)

  const searched = await requestCatalog(database, {
    category: 'games', franchise: 'saga-alfa', q: 'pokemon', limit: PAGE_SIZE,
  })
  assert.equal(searched.response.status, 200)
  assert.equal(searched.body.items.length, PAGE_SIZE)
  assert.equal(searched.body.items[0].code, 'R29-00001')
  assert.ok(searched.body.nextCursor)
})
