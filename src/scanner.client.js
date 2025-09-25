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
import { mapScannerResultToToken } from './tdd.runtime.js'

// In Vite dev, prefer a relative base ('') so requests hit the dev proxy (/scanner)
// Otherwise use VITE_API_BASE if provided, falling back to the public API.
const isViteDev = (() => {
  try {
    // import.meta is available in ESM; env is injected by Vite in dev
    return Boolean(import.meta && import.meta.env && import.meta.env.DEV)
  } catch (_) {
    return false
  }
})()
const viteApiBase = (() => { try { return (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || null } catch { return null } })()
// In dev, prefer relative base ('') so Vite proxy can handle /scanner when running the dev server.
// Fall back to localhost:3001 only if explicitly provided via VITE_API_BASE.
export const API_BASE = isViteDev ? (viteApiBase || '') : (viteApiBase || 'https://api-rs.dexcelerate.com')

// Build URLSearchParams from GetScannerResultParams-like object
/**
 * Build URLSearchParams from a Scanner filter-like object.
 * - Arrays are expanded as repeated params.
 * - Null/undefined/empty string values are omitted.
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
 */
export function mapScannerPage(apiResponse) {
  const items = apiResponse?.scannerPairs ?? []
  return items.map(mapScannerResultToToken)
}

// Fetch scanner page and return mapped TokenData[] and raw payload
export async function fetchScanner(params, opts = {}) {
  const baseUrl = opts.baseUrl ?? API_BASE
  const fetchImpl = opts.fetchImpl ?? fetch
  const qp = buildScannerQuery(params)

  const url = `${baseUrl}/scanner?${qp.toString()}`
  const res = await fetchImpl(url, { headers: { 'accept': 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`Scanner request failed ${res.status}: ${text}`)
    // @ts-expect-error augment for callers in JS
    err.status = res.status
    throw err
  }
  const json = await res.json()
  return { raw: json, tokens: mapScannerPage(json) }
}
