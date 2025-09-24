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
export const API_BASE = isViteDev ? (viteApiBase || 'http://localhost:3001') : (viteApiBase || 'https://api-rs.dexcelerate.com')

// Build URLSearchParams from GetScannerResultParams-like object
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
    err.status = res.status
    throw err
  }
  const json = await res.json()
  return { raw: json, tokens: mapScannerPage(json) }
}
