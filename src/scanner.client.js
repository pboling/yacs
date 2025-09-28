/*
  scanner.client.js
  Small, framework-agnostic REST client for GET /scanner.
  - In dev, defaults to hitting the local Express backend (http://localhost:3001)
    unless VITE_API_BASE is configured.
  - In prod, defaults to the public API unless overridden.
  - All functions are pure and testable; network is injectable.
*/
// Pure REST client utilities for /scanner (ESM, JS for node:test)
// No direct network in tests: fetch is injected.
import { mapRESTScannerResultToToken } from './tdd.runtime.js'
import { debugLog } from './utils/debug.mjs'

// In Vite dev, prefer a relative base ('') so requests hit the dev proxy (/scanner)
// Otherwise use VITE_API_BASE if provided, falling back to the public API.
const viteApiBase = (() => {
  try {
    return (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || null
  } catch {
    return null
  }
})()
// In dev, prefer relative base ('') so Vite proxy can handle /scanner when running the dev server.
// Fall back to localhost:3001 only if explicitly provided via VITE_API_BASE.
export const API_BASE = viteApiBase || 'https://api-rs.dexcelerate.com'

// Build URLSearchParams from GetScannerResultParams-like object
/**
 * Build URLSearchParams from a Scanner filter-like object.
 *
 * Rules
 * - Arrays are expanded as repeated params (?k=a&k=b).
 * - Null/undefined/empty string values are omitted.
 * - Other values are coerced to string.
 *
 * @param {Record<string, any>} [params]
 * @returns {URLSearchParams}
 */
export function buildScannerQuery(params = {}) {
  const qp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      // arrays -> repeated params
      for (const item of v) qp.append(k, String(item))
    } else {
      qp.set(k, String(v))
    }
  }
  return qp
}

// Map ScannerApiResponse to TokenData[]
/**
 * Map a ScannerApiResponse-like object to an array of TokenData (UI shape).
 * Delegates per-item conversion to mapScannerResultToToken.
 *
 * Shape source of truth: tests/fixtures/scanner.*.json
 * Expected API response shape: { pairs: [...] }
 *
 * @param {{ pairs?: any[] }} apiResponse
 * @returns {any[]} TokenData[]
 */
export function mapScannerPage(apiResponse) {
  const items = apiResponse && Array.isArray(apiResponse.pairs) ? apiResponse.pairs : []
  return items.map(mapRESTScannerResultToToken)
}

/*
  --- ACTION TYPE CLARIFICATION FOR DOWNSTREAM ---
  fetchScanner returns tokens already mapped to TokenData shape (via mapScannerPage).
  When dispatching these results to the reducer, use 'scanner/pairsTokens' with payload { page, tokens }.
  If you have raw API results (unmapped), use 'scanner/pairs' and let the reducer map them.
  This distinction ensures efficient data flow and avoids redundant mapping.
  ------------------------------------------------
*/

// Fetch scanner page and return mapped TokenData[] and raw payload
/**
 * Fetch a scanner page and map it to TokenData[] with the raw payload.
 *
 * Networking is injectable for tests via opts.fetchImpl; baseUrl is also overridable.
 * Errors include response status on the thrown Error instance (err.status).
 *
 * @param {Record<string, any>} params - Scanner filter params.
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ raw: any, tokens: any[] }>}
 */
export async function fetchScanner(params, opts = {}) {
  const baseUrl = opts.baseUrl ?? API_BASE
  const fetchImpl = opts.fetchImpl ?? fetch
  const qp = buildScannerQuery(params)

  const url = `${baseUrl}/scanner?${qp.toString()}`
  const startedAt = Date.now()
  if (params && params.__source) {
    debugLog(`[scanner] source: ${params.__source}`)
  }
  try {
    debugLog('[scanner] → GET', url)
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } })
    debugLog('[scanner] ← status', res.status, url)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const ms = Date.now() - startedAt
      console.error('[scanner] ✖ failed', {
        status: res.status,
        ms,
        url,
        sample: text?.slice?.(0, 200) || '',
      })
      const err = new Error(`Scanner request failed ${res.status}: ${text}`)
      // @ts-expect-error augment for callers in JS
      err.status = res.status
      throw err
    }
    const json = await res.json()
    const tokens = mapScannerPage(json)
    const ms = Date.now() - startedAt
    debugLog('[scanner] ✓ success', { status: res.status, count: tokens.length, ms, url })
    return { raw: json, tokens }
  } catch (err) {
    const ms = Date.now() - startedAt
    const message = err && err.message ? err.message : String(err)
    console.error('[scanner] ✖ network error', { ms, url, message })
    throw err
  }
}
