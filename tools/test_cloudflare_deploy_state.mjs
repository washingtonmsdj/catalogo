import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeVersionIdFromDeployments,
  uploadedVersionIdFromWranglerNdjson,
  versionOverrideHeaderValue,
} from './cloudflare_deploy_state.mjs'
import { fetchWithVersionOverride, runBoundedRetry } from './check_staged_worker_version.mjs'

const OLD_VERSION = '11111111-2222-4333-8444-555555555555'
const NEW_VERSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

test('reads the newest single 100% active production version deterministically', () => {
  assert.equal(
    activeVersionIdFromDeployments({
      result: {
        deployments: [
          {
            created_on: '2026-10-09T21:00:00.000Z',
            versions: [{ version_id: NEW_VERSION, percentage: 100 }],
          },
          {
            created_on: '2026-10-09T22:15:05.550Z',
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
              created_on: '2026-10-09T22:15:05.550Z',
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

test('bounded retry returns immediately on first success', async () => {
  let calls = 0
  let sleeps = 0
  const result = await runBoundedRetry(
    async () => {
      calls += 1
      return 'ok'
    },
    {
      attempts: 5,
      delayMs: 10,
      sleepImpl: async () => {
        sleeps += 1
      },
    },
  )

  assert.equal(result, 'ok')
  assert.equal(calls, 1)
  assert.equal(sleeps, 0)
})

test('bounded retry recovers from transient failures with exact delays', async () => {
  let calls = 0
  const delays = []
  const retries = []
  const result = await runBoundedRetry(
    async () => {
      calls += 1
      if (calls < 3) throw new Error(`transient-${calls}`)
      return 'ready'
    },
    {
      attempts: 5,
      delayMs: 25,
      sleepImpl: async (delay) => delays.push(delay),
      onRetry: ({ attempt, error }) => retries.push([attempt, error.message]),
    },
  )

  assert.equal(result, 'ready')
  assert.equal(calls, 3)
  assert.deepEqual(delays, [25, 25])
  assert.deepEqual(retries, [[1, 'transient-1'], [2, 'transient-2']])
})

test('bounded retry stops at the configured attempt limit and preserves final cause', async () => {
  let calls = 0
  let sleeps = 0
  await assert.rejects(
    runBoundedRetry(
      async () => {
        calls += 1
        throw new Error(`failure-${calls}`)
      },
      {
        attempts: 3,
        delayMs: 0,
        sleepImpl: async () => {
          sleeps += 1
        },
      },
    ),
    (error) => {
      assert.match(error.message, /Operation failed after 3 attempts: failure-3/)
      assert.equal(error.cause?.message, 'failure-3')
      return true
    },
  )
  assert.equal(calls, 3)
  assert.equal(sleeps, 2)
})

test('bounded retry rejects invalid limits before invoking the operation', async () => {
  let calls = 0
  await assert.rejects(
    runBoundedRetry(async () => {
      calls += 1
    }, { attempts: 0 }),
    /attempts must be an integer between 1 and 10/,
  )
  assert.equal(calls, 0)
})
