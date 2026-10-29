import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import esbuild from 'esbuild'

const schemaContract = JSON.parse(readFileSync(new URL('../config/catalog-schema-contract.json', import.meta.url), 'utf8'))
const bundled = await esbuild.build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  write: false,
})
const workerModule = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

function databaseHarness() {
  const catalogQueries = []
  const database = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() {
              if (sql.includes('FROM d1_migrations')) return { results: values.map((name) => ({ name })) }
              if (sql.includes('FROM sqlite_schema')) {
                const rows = []
                for (let index = 0; index < values.length; index += 2) {
                  rows.push({ type: values[index], name: values[index + 1] })
                }
                return { results: rows }
              }
              const table = sql.match(/pragma_table_info\('([^']+)'\)/)?.[1]
              if (table) return { results: values.map((name) => ({ name })) }
              if (sql.includes('SELECT m.id,m.slug,m.code,m.name')) {
                catalogQueries.push({ sql, values })
                return { results: [] }
              }
              return { results: [] }
            },
            async first() { return null },
            async run() { return {} },
          }
        },
      }
    },
    async batch() { return {} },
  }
  return { database, catalogQueries }
}

function requestUrl(params) {
  const url = new URL('https://catalog.example.test/api/catalog')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

test('worker binds attribute facets before the stable cursor and page limit', async () => {
  const { database, catalogQueries } = databaseHarness()
  const cursor = Buffer.from(JSON.stringify({ name: 'Alpha', id: 'model-123' })).toString('base64url')
  const response = await workerModule.default.fetch(new Request(requestUrl({
    category: 'games',
    franchise: 'some-franchise',
    material: 'PVC%',
    collection: 'Art_Scale',
    minHeight: '20',
    maxHeight: '60',
    cursor,
    limit: '48',
  })), { DB: database, MEDIA: { get: async () => null }, CORS_ORIGINS: '' })

  assert.equal(response.status, 200)
  assert.equal(catalogQueries.length, 1)
  const { sql, values } = catalogQueries[0]
  assert.match(sql, /LOWER\(COALESCE\(m\.material, ''\)\) LIKE LOWER\(\?\) ESCAPE '\\'/)
  assert.match(sql, /LOWER\(COALESCE\(m\.collection, ''\)\) LIKE LOWER\(\?\) ESCAPE '\\'/)
  assert.match(sql, /m\.height_cm >= \?/)
  assert.match(sql, /m\.height_cm <= \?/)
  assert.match(sql, /m\.name COLLATE NOCASE > \?/)
  assert.deepEqual(values, [
    'games', 'some-franchise', '%PVC\\%%', '%Art\\_Scale%', 20, 60,
    'Alpha', 'Alpha', 'model-123', 49,
  ])
})

test('worker rejects invalid height ranges without querying catalog rows', async () => {
  const { database, catalogQueries } = databaseHarness()
  const response = await workerModule.default.fetch(new Request(requestUrl({ minHeight: '61', maxHeight: '60' })), {
    DB: database, MEDIA: { get: async () => null }, CORS_ORIGINS: '',
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalid_height_range' })
  assert.equal(catalogQueries.length, 0)
})

test('worker fails closed for heights outside supported bounds', async () => {
  const { database, catalogQueries } = databaseHarness()
  const response = await workerModule.default.fetch(new Request(requestUrl({ minHeight: '301' })), {
    DB: database, MEDIA: { get: async () => null }, CORS_ORIGINS: '',
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalid_height_range' })
  assert.equal(catalogQueries.length, 0)
})
