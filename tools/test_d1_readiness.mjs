import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyD1Readiness, validateD1ProbeResponse, D1ReadinessError } from './check_d1_readiness.mjs'

const accountId = 'a'.repeat(32)
const databaseId = '87006366-60f3-4937-af73-2ef5a5f901fb'
const token = 'private-testing-token'
const baseline = '0001_catalog.sql'
const healthy = { success: true, result: [{ success: true, results: [{ name: baseline }] }] }

function assertFailure(code) {
  return error => error instanceof D1ReadinessError && error.code === code &&
    !error.message.includes(token)
}

test('read-only D1 quota probe uses SSOT baseline and never requests customer rows', async () => {
  let calls = 0
  const actual = await verifyD1Readiness({
    accountId, databaseId, token,
    fetchImpl: async (url, options) => {
      calls++
      assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/' +
        accountId + '/d1/database/' + databaseId + '/query')
      assert.equal(options.method, 'POST')
      assert.equal(options.headers.authorization, 'Bearer ' + token)
      assert.deepEqual(JSON.parse(options.body), {
        sql: 'SELECT name FROM d1_migrations WHERE name = ? LIMIT 1',
        params: [baseline],
      })
      return { status: 200, json: async () => healthy }
    },
  })
  assert.equal(calls, 1)
  assert.deepEqual(actual, { ready: true, baseline })
})

test('Cloudflare D1 free-tier 7500 fails immediately without retries or leaks', async () => {
  let calls = 0
  await assert.rejects(() => verifyD1Readiness({
    accountId, databaseId, token,
    fetchImpl: async () => {
      calls++
      return { status: 429, json: async () => ({ success: false,
        errors: [{ code: 7500, message: 'quota exhausted and sensitive details' }] }) }
    },
  }), assertFailure('d1_daily_read_quota_exceeded'))
  assert.equal(calls, 1)
})

test('D1 query failure and absent baseline are not interpreted as a successful deploy', () => {
  assert.throws(() => validateD1ProbeResponse(200, {success:true,result:[{success:true,results:[]}]}),
    assertFailure('d1_schema_baseline_not_confirmed'))
  assert.throws(() => validateD1ProbeResponse(500, {success:false,errors:[{code:9999,message:'internal detail'}]}),
    assertFailure('d1_probe_unavailable'))
  assert.throws(() => validateD1ProbeResponse(200, {success:true,result:[{success:false,errors:[{code:7500}]}]}),
    assertFailure('d1_daily_read_quota_exceeded'))
})

test('missing credentials, request exceptions and bad JSON fail closed', async () => {
  await assert.rejects(() => verifyD1Readiness({
    accountId, databaseId, token:'',fetchImpl:()=>{throw Error('should not run')},
  }), assertFailure('d1_probe_configuration_invalid'))
  await assert.rejects(() => verifyD1Readiness({
    accountId, databaseId, token,fetchImpl:async()=>{throw Error('network error with private token')},
  }), assertFailure('d1_probe_network_unavailable'))
  await assert.rejects(() => verifyD1Readiness({
    accountId, databaseId, token,fetchImpl:async()=>({status:200,json:async()=>{throw Error(token)}}),
  }), assertFailure('d1_probe_invalid_response'))
})
