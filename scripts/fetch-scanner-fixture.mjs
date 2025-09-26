// scripts/fetch-scanner-fixture.mjs
// Fetch the REST /scanner endpoint (same one the app uses) and save as a fixture.
// Refactored to use src/scanner.client.js so mapping and defaults stay consistent
// with the application. If the endpoint is not reachable, gracefully fall back
// to generating a deterministic fixture using src/scanner.endpoint.js.
//
// Usage:
//   node scripts/fetch-scanner-fixture.mjs [URL]
// Env:
//   SCANNER_URL=<url>   # alternative to CLI arg
// Examples:
//   node scripts/fetch-scanner-fixture.mjs https://api-rs.dexcelerate.com/scanner?chain=ETH&page=1
//   node scripts/fetch-scanner-fixture.mjs
// Output: tests/fixtures/scanner.initial.json

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_URL = 'https://api-rs.dexcelerate.com/scanner?chain=ETH&page=1'

function parseParamsFromUrl(u) {
  try {
    const url = new URL(u)
    const p = Object.fromEntries(url.searchParams.entries())
    // Normalize a few known ones to generator expectations
    const out = { ...p }
    if (typeof out.page !== 'undefined') out.page = Number(out.page)
    if (typeof out.isNotHP !== 'undefined') out.isNotHP = String(out.isNotHP) === 'true'
    // pass-through: chain, rankBy, sort, dir, etc.
    return out
  } catch {
    return { chain: 'ETH', page: 1, isNotHP: true }
  }
}

function deriveBaseUrlFromFullScannerUrl(u) {
  // Given a full URL like https://host[:port][/prefix]/scanner?..., return
  // baseUrl = https://host[:port][/prefix]
  try {
    const url = new URL(u)
    const path = url.pathname || '/'
    const idx = path.lastIndexOf('/scanner')
    const prefix = idx >= 0 ? path.slice(0, idx) : ''
    const base = url.origin + prefix
    return base.replace(/\/$/, '') || url.origin
  } catch {
    return ''
  }
}

async function saveFixture(json, note = '') {
  const outDir = path.resolve(__dirname, '..', 'tests', 'fixtures')
  const outFile = path.resolve(outDir, 'scanner.initial.json')
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(outFile, JSON.stringify(json, null, 2))
  const count = Array.isArray(json.pairs)
    ? json.pairs.length
    : Array.isArray(json.scannerPairs)
    ? json.scannerPairs.length
    : 0
  const suffix = note ? ` (${note})` : ''
  console.log(`Saved fixture to ${outFile} with ${count} items${suffix}`)
}

function withTimeoutFetch(ms = 5000) {
  return async (url, opts = {}) => {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), ms)
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal })
      return res
    } finally {
      clearTimeout(id)
    }
  }
}

async function main() {
  const url = process.env.SCANNER_URL || process.argv[2] || DEFAULT_URL
  // Lazy import to avoid ESM cycles at parse time
  const { fetchScanner } = await import('../src/scanner.client.js')
  try {
    const params = parseParamsFromUrl(url)
    const baseUrl = deriveBaseUrlFromFullScannerUrl(url) || undefined
    const fetchImpl = withTimeoutFetch(5000)
    const { raw, tokens } = await fetchScanner(params, { baseUrl, fetchImpl })
    // We persist the raw JSON payload; tokens are computed and logged for info only
    await saveFixture(raw)
    console.log(`[fixture:scanner] Tokens derived by client mapper: ${tokens.length}`)
    return
  } catch (err) {
    const msg = (err && err.message) || String(err)
    console.error('\n[fixture:scanner] Fetch via scanner.client failed:')
    console.error('  ' + msg)
    if (/ECONNREFUSED|abort|ENOTFOUND|TIMED?OUT/i.test(msg)) {
      console.error('\nEndpoint appears unreachable. You can:')
      console.error('  - Use default public API (no action needed)')
      console.error('  - Or pass a reachable URL: node scripts/fetch-scanner-fixture.mjs https://api.example/scanner?...')
      console.error('  - Or set SCANNER_URL env: SCANNER_URL=https://host[:port]/scanner?chain=ETH&page=1\n')
    }
    // Graceful fallback: generate a deterministic fixture using our in-repo generator
    try {
      const params = parseParamsFromUrl(url)
      const mod = await import('../src/scanner.endpoint.js')
      const json = mod.generateScannerResponse(params)
      await saveFixture(json, 'generated fallback')
      return
    } catch (genErr) {
      console.error('[fixture:scanner] Fallback generation failed:', genErr)
      process.exitCode = 1
    }
  }
}

main()
