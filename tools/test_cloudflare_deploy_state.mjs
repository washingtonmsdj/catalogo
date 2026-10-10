import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeVersionIdFromDeployments,
  uploadedVersionIdFromWranglerNdjson,
  versionOverrideHeaderValue,
} from './cloudflare_deploy_state.mjs'
import { fetchWithVersionOverride } from './check_staged_worker_version.mjs'

const OLD_VERSION = '11111111-2222-4333-8444-555555555555'
const NEW_VERSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

test('reads the single 100% active production version', () => {
  assert.equal(
    activeVersionIdFromDeployments({
      result: {
        deployments: [
          {
            versions: [{ version_id: OLD_VERSION, percentage: 100 }],
          },
        ],
      },
    }),
    OLD_VERSION,
  )
})

test('rejects split production state as ambiguous rollback target', () => {
  assert.throws(
    () =>
      activeVersionIdFromDeployments({
        result: {
          deployments: [
            {
              versions: [
                { version_id: OLD_VERSION, percentage: 90 },
                { version_id: NEW_VERSION, percentage: 10 },
              ],
            },
          ],
        },
      }),
    /exactly one Worker version/,
  )
})

test('reads exactly one version-upload event from Wrangler NDJSON', () => {
  const text = [
    JSON.stringify({ type: 'wrangler-session', version: 1 }),
    JSON.stringify({ type: 'version-upload', version: 1, version_id: NEW_VERSION }),
  ].join('\n')
  assert.equal(uploadedVersionIdFromWranglerNdjson(text), NEW_VERSION)
})

test('rejects ambiguous Wrangler output with multiple uploads', () => {
  const text = [
    JSON.stringify({ type: 'version-upload', version_id: OLD_VERSION }),
    JSON.stringify({ type: 'version-upload', version_id: NEW_VERSION }),
  ].join('\n')
  assert.throws(() => uploadedVersionIdFromWranglerNdjson(text), /exactly one version-upload/)
})

test('builds a Worker version override header from canonical identifiers', () => {
  assert.equal(
    versionOverrideHeaderValue('tonecos-catalogo-api', NEW_VERSION),
    `tonecos-catalogo-api="${NEW_VERSION}"`,
  )
})

test('staged fetch preserves existing headers and injects version override', async () => {
  let captured
  const fakeFetch = async (url, init) => {
    captured = { url, init }
    return { ok: true }
  }
  const wrapped = fetchWithVersionOverride(fakeFetch, `tonecos-catalogo-api="${NEW_VERSION}"`)
  await wrapped('https://example.test/api/health', { headers: { accept: 'application/json' } })

  assert.equal(captured.url, 'https://example.test/api/health')
  assert.equal(captured.init.headers.get('accept'), 'application/json')
  assert.equal(
    captured.init.headers.get('Cloudflare-Workers-Version-Overrides'),
    `tonecos-catalogo-api="${NEW_VERSION}"`,
  )
})
