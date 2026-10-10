#!/usr/bin/env node
import { canonicalD1DatabaseId, loadWranglerConfig } from './wrangler_config_contract.mjs'

const config = await loadWranglerConfig()
process.stdout.write(canonicalD1DatabaseId(config))
