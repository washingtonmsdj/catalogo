import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalD1DatabaseId, loadWranglerConfig } from './wrangler_config_contract.mjs'

const SYNTHETIC_ID = '11111111-2222-4333-8444-555555555555'

test('repository wrangler config exposes one canonical DB binding', async () => {
  const config = await loadWranglerConfig()
  const databaseId = canonicalD1DatabaseId(config)
  assert.match(databaseId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  assert.notEqual(databaseId, 'REPLACE_AFTER_D1_CREATE')
})

test('canonical D1 binding rejects missing, duplicate and placeholder ids', () => {
  assert.throws(() => canonicalD1DatabaseId({}), /must declare d1_databases/)
  assert.throws(
    () => canonicalD1DatabaseId({ d1_databases: [{ binding: 'OTHER', database_id: SYNTHETIC_ID }] }),
    /exactly one D1 binding named DB/,
  )
  assert.throws(
    () => canonicalD1DatabaseId({
      d1_databases: [
        { binding: 'DB', database_id: SYNTHETIC_ID },
        { binding: 'DB', database_id: SYNTHETIC_ID },
      ],
    }),
    /found 2/,
  )
  assert.throws(
    () => canonicalD1DatabaseId({
      d1_databases: [{ binding: 'DB', database_id: 'REPLACE_AFTER_D1_CREATE' }],
    }),
    /canonical Cloudflare database UUID/,
  )
})

test('canonical D1 binding rejects loose UUID-like strings', () => {
  assert.throws(
    () => canonicalD1DatabaseId({
      d1_databases: [{ binding: 'DB', database_id: `${SYNTHETIC_ID}-extra` }],
    }),
    /canonical Cloudflare database UUID/,
  )
})
