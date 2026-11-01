import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertManagedR2PrivateAccess,
  assertRemoteWorkerConfig,
  expectedRemoteWorkerConfig,
  fetchRemoteR2ManagedDomain,
} from './check_remote_worker_config.mjs'

const canonical = {
  name: 'tonecos-catalogo-api',
  compatibility_date: '2026-09-30',
  compatibility_flags: ['nodejs_compat'],
  vars: {
    CORS_ORIGINS: 'https://washingtonmsdj.github.io,https://acheguese.com.br,https://www.acheguese.com.br',
  },
  secrets: { required: ['TURNSTILE_SECRET_KEY'] },
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'tonecos-catalogo',
      database_id: '87006366-60f3-4937-af73-2ef5a5f901fb',
      migrations_dir: 'migrations',
    },
  ],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: 'tonecos-catalogo-media' }],
  observability: { enabled: true },
}

function remote(overrides = {}) {
  return {
    compatibility_date: '2026-09-30',
    compatibility_flags: ['nodejs_compat'],
    observability: { enabled: true },
    bindings: [
      {
        name: 'CORS_ORIGINS',
        type: 'plain_text',
        text: canonical.vars.CORS_ORIGINS,
      },
      {
        name: 'DB',
        type: 'd1',
        id: canonical.d1_databases[0].database_id,
        database_id: canonical.d1_databases[0].database_id,
      },
      {
        name: 'MEDIA',
        type: 'r2_bucket',
        bucket_name: 'tonecos-catalogo-media',
      },
      {
        name: 'TURNSTILE_SECRET_KEY',
        type: 'secret_text',
      },
    ],
    ...overrides,
  }
}

const expected = expectedRemoteWorkerConfig(canonical)

test('matching remote Worker configuration passes', () => {
  assert.doesNotThrow(() => assertRemoteWorkerConfig(expected, remote()))
})

test('CORS drift fails closed', () => {
  const value = remote()
  value.bindings[0] = { ...value.bindings[0], text: `${canonical.vars.CORS_ORIGINS},http://localhost:5173` }
  assert.throws(() => assertRemoteWorkerConfig(expected, value), /CORS_ORIGINS drift/)
})

test('planned CORS expansion is additive only and remains strict after release', () => {
  const updated = structuredClone(canonical)
  updated.vars.CORS_ORIGINS += ',https://acheguese.vercel.app'
  const planned = expectedRemoteWorkerConfig(updated)
  assert.throws(() => assertRemoteWorkerConfig(planned, remote()), /CORS_ORIGINS drift/)
  assert.doesNotThrow(() => assertRemoteWorkerConfig(planned, remote(), { allowCorsExpansion: true }))
  assert.doesNotThrow(() => assertRemoteWorkerConfig(planned, {
    ...remote(),
    bindings: remote().bindings.map(binding => binding.name === 'CORS_ORIGINS'
      ? { ...binding, text: updated.vars.CORS_ORIGINS } : binding),
  }))

  const unexpected = remote()
  unexpected.bindings[0].text += ',https://unreviewed.example'
  assert.throws(() => assertRemoteWorkerConfig(planned, unexpected, { allowCorsExpansion: true }), /CORS_ORIGINS drift/)

  const reduced = structuredClone(canonical)
  reduced.vars.CORS_ORIGINS = reduced.vars.CORS_ORIGINS.split(',').filter(origin => origin !== 'https://acheguese.com.br').join(',')
  assert.throws(
    () => assertRemoteWorkerConfig(expectedRemoteWorkerConfig(reduced), remote(), { allowCorsExpansion: true }),
    /CORS_ORIGINS drift/,
  )
})

test('canonical CORS never admits wildcard, duplicate or HTTP origins', () => {
  for (const origin of ['https://*.vercel.app', 'http://localhost:5173', 'https://acheguese.com.br/']) {
    const bad = structuredClone(canonical)
    bad.vars.CORS_ORIGINS += ',' + origin
    assert.throws(() => expectedRemoteWorkerConfig(bad), /CORS_ORIGINS requires exact HTTPS origins/)
  }
  const duplicated = structuredClone(canonical)
  duplicated.vars.CORS_ORIGINS += ',https://acheguese.com.br'
  assert.throws(() => expectedRemoteWorkerConfig(duplicated), /CORS_ORIGINS contains duplicates/)
})

test('D1 resource drift fails closed', () => {
  const value = remote()
  value.bindings[1] = { ...value.bindings[1], id: '00000000-0000-0000-0000-000000000000', database_id: '00000000-0000-0000-0000-000000000000' }
  assert.throws(() => assertRemoteWorkerConfig(expected, value), /Remote DB binding drift/)
})

test('missing or unexpected bindings fail closed', () => {
  const missing = remote()
  missing.bindings = missing.bindings.filter((binding) => binding.name !== 'MEDIA')
  assert.throws(() => assertRemoteWorkerConfig(expected, missing), /Remote binding set drift/)

  const extra = remote()
  extra.bindings.push({ name: 'UNTRACKED', type: 'plain_text', text: 'unexpected' })
  assert.throws(() => assertRemoteWorkerConfig(expected, extra), /Remote binding set drift/)
})

test('Turnstile binding must remain secret material', () => {
  const value = remote()
  value.bindings[3] = { name: 'TURNSTILE_SECRET_KEY', type: 'plain_text', text: 'never-allowed' }
  assert.throws(() => assertRemoteWorkerConfig(expected, value), /unexpected type/)
})

test('compatibility and observability drift fail closed', () => {
  assert.throws(
    () => assertRemoteWorkerConfig(expected, remote({ compatibility_date: '2026-09-29' })),
    /compatibility_date drift/,
  )
  assert.throws(
    () => assertRemoteWorkerConfig(expected, remote({ compatibility_flags: [] })),
    /compatibility_flags drift/,
  )
  assert.throws(
    () => assertRemoteWorkerConfig(expected, remote({ observability: { enabled: false } })),
    /observability drift/,
  )
})

test('local-only D1 metadata is intentionally not compared with remote bindings', () => {
  const config = structuredClone(canonical)
  config.d1_databases[0].database_name = 'renamed-local-label'
  config.d1_databases[0].migrations_dir = 'different-local-migrations-dir'
  const semanticExpected = expectedRemoteWorkerConfig(config)
  assert.doesNotThrow(() => assertRemoteWorkerConfig(semanticExpected, remote()))
})

test('R2 managed public development access must remain disabled', () => {
  assert.doesNotThrow(() => assertManagedR2PrivateAccess({ enabled: false }))
  assert.throws(
    () => assertManagedR2PrivateAccess({ enabled: true }),
    /public development access drift: expected enabled=false, found enabled=true/,
  )
  assert.throws(
    () => assertManagedR2PrivateAccess({}),
    /managed-domain response is invalid/,
  )
})

test('R2 managed-domain state is read from the canonical MEDIA bucket', async () => {
  const calls = []
  const result = await fetchRemoteR2ManagedDomain({
    accountId: 'account-test',
    apiToken: 'token-test',
    bucketName: 'tonecos-catalogo-media',
    async fetchImpl(url, init) {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true, result: { enabled: false } }
        },
      }
    },
  })

  assert.deepEqual(result, { enabled: false })
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/r2\/buckets\/tonecos-catalogo-media\/domains\/managed$/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token-test')
})

test('R2 managed-domain API failure is fail-closed', async () => {
  await assert.rejects(
    () => fetchRemoteR2ManagedDomain({
      accountId: 'account-test',
      apiToken: 'token-test',
      bucketName: 'tonecos-catalogo-media',
      async fetchImpl() {
        return {
          ok: false,
          status: 403,
          async json() {
            return { success: false, errors: [{ code: 10000, message: 'forbidden' }] }
          },
        }
      },
    }),
    /Unable to read remote R2 managed-domain state \(403\): 10000:forbidden/,
  )
})
