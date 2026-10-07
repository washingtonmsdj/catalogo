#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schemaContract = JSON.parse(
  fs.readFileSync(path.join(root, 'config/catalog-schema-contract.json'), 'utf8'),
)

function requiredStructureCount() {
  const objects = schemaContract.requiredObjects
  const named = objects.tables.length + objects.indexes.length + objects.triggers.length
  const columns = Object.values(objects.columns).reduce((sum, entries) => sum + entries.length, 0)
  return named + columns
}

export function validateWorkerHealth(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('health payload is invalid')
  if (payload.ok !== true) throw new Error('worker reported ok=false')
  if (payload.service !== 'tonecos-catalogo') throw new Error('worker service identity mismatch')

  const schema = payload.schema
  if (!schema || typeof schema !== 'object') throw new Error('health payload has no schema status')
  if (schema.ready !== true) throw new Error('worker schema is not ready')
  if (schema.contractVersion !== schemaContract.version) {
    throw new Error(`schema contract version mismatch: ${schema.contractVersion} != ${schemaContract.version}`)
  }
  if (schema.latestMigration !== schemaContract.latestMigration) {
    throw new Error(`latest migration mismatch: ${schema.latestMigration} != ${schemaContract.latestMigration}`)
  }
  if (schema.requiredMigrations !== schemaContract.requiredMigrations.length) {
    throw new Error('required migration count mismatch')
  }
  if (schema.appliedMigrations !== schemaContract.requiredMigrations.length) {
    throw new Error('applied migration count mismatch')
  }
  if (!Array.isArray(schema.missingMigrations) || schema.missingMigrations.length !== 0) {
    throw new Error('health payload reports missing migrations')
  }
  const structures = requiredStructureCount()
  if (schema.requiredStructures !== structures) {
    throw new Error('required structure count mismatch')
  }
  if (schema.verifiedStructures !== structures) {
    throw new Error('verified structure count mismatch')
  }
  if (!Array.isArray(schema.missingStructures) || schema.missingStructures.length !== 0) {
    throw new Error('health payload reports missing structures')
  }

  return {
    ok: true,
    service: payload.service,
    contractVersion: schema.contractVersion,
    latestMigration: schema.latestMigration,
    appliedMigrations: schema.appliedMigrations,
    verifiedStructures: schema.verifiedStructures,
  }
}

export async function verifyWorkerHealth(apiBase, fetchImpl = fetch) {
  const base = String(apiBase ?? '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('API base must be http(s)')
  const response = await fetchImpl(`${base}/api/health`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'tonecos-catalog-health-smoke/1',
    },
  })
  if (!response?.ok) {
    throw new Error(`health failed with HTTP ${response?.status ?? 'unknown'}`)
  }
  return validateWorkerHealth(await response.json())
}

async function main() {
  const apiBase = process.argv[2] || process.env.CATALOG_API_URL || process.env.VITE_API_BASE_URL
  if (!apiBase) throw new Error('API base is required as argv[2], CATALOG_API_URL or VITE_API_BASE_URL')
  process.stdout.write(JSON.stringify(await verifyWorkerHealth(apiBase)) + '\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}
