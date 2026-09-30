import { readFile, writeFile } from 'node:fs/promises'

const sourcePath = new URL('../wrangler.jsonc', import.meta.url)
const outputPath = new URL('../.wrangler.deploy.jsonc', import.meta.url)
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim()
const corsOrigins = process.env.CATALOG_CORS_ORIGINS?.trim()

if (!databaseId) {
  throw new Error('CLOUDFLARE_D1_DATABASE_ID is required')
}

if (!/^[0-9a-f-]{32,36}$/i.test(databaseId)) {
  throw new Error('CLOUDFLARE_D1_DATABASE_ID does not look like a D1 UUID')
}

const raw = await readFile(sourcePath, 'utf8')
const config = JSON.parse(raw)

if (!Array.isArray(config.d1_databases) || config.d1_databases.length !== 1) {
  throw new Error('Expected exactly one D1 binding in wrangler.jsonc')
}

config.d1_databases[0].database_id = databaseId
if (corsOrigins) config.vars = { ...(config.vars ?? {}), CORS_ORIGINS: corsOrigins }

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
console.log(`Rendered ${outputPath.pathname} for database ${databaseId.slice(0, 8)}…`)
