import { writeFile } from 'node:fs/promises'
import { canonicalD1DatabaseId, loadWranglerConfig } from './wrangler_config_contract.mjs'

const outputPath = new URL('../.wrangler.deploy.jsonc', import.meta.url)
const assertedDatabaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim()

const config = await loadWranglerConfig()
const databaseId = canonicalD1DatabaseId(config)

if (assertedDatabaseId && assertedDatabaseId !== databaseId) {
  throw new Error(
    `CLOUDFLARE_D1_DATABASE_ID diverges from wrangler.jsonc (${assertedDatabaseId} != ${databaseId})`,
  )
}

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
console.log(`Rendered ${outputPath.pathname} from canonical database ${databaseId.slice(0, 8)}…`)
