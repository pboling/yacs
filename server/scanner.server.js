/*
  scanner.server.js
  Minimal Express application exposing:
  - GET /scanner  → deterministic mock data powered by src/scanner.endpoint.js
  - GET /healthz  → simple healthcheck for integration tests and supervisors

  CORS: A permissive CORS middleware is applied to simplify local development
  (Access-Control-Allow-Origin: *). Adjust for production as needed.
*/
// Minimal Express app that serves GET /scanner using the deterministic generator
// ESM module (package.json "type": "module")
import express from 'express'
import { generateScannerResponse } from '../src/scanner.endpoint.js'

export function createApp() {
  const app = express()

  // Minimal CORS for development: allow all origins and handle preflight
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204)
    }
    next()
  })

  app.get('/scanner', (req, res) => {
    // Normalize query params: numbers/booleans where applicable
    const norm = { ...req.query }
    if (typeof norm.page !== 'undefined') norm.page = Number(norm.page)
    if (typeof norm.isNotHP !== 'undefined') norm.isNotHP = String(norm.isNotHP) === 'true'

    // Allow-listed server-side sorting for bookmarkable initial load
    // sort: one of ['tokenName','exchange','price','priceUsd','mcap','volume','volumeUsd','age','tx','liquidity']
    // dir:  one of ['asc','desc']
    const sortAllow = new Set(['tokenName','exchange','price','priceUsd','mcap','volume','volumeUsd','age','tx','liquidity'])
    const dirAllow = new Set(['asc','desc'])
    const sortParam = typeof norm.sort === 'string' ? norm.sort : undefined
    const dirParam = typeof norm.dir === 'string' ? norm.dir.toLowerCase() : undefined
    // Pass through to generator (seeded), but we'll sort response below
    const json = generateScannerResponse(norm)

    try {
      const sortKey = sortParam && sortAllow.has(sortParam) ? sortParam : undefined
      const sortDir = dirParam && dirAllow.has(dirParam) ? dirParam : 'desc'
      if (sortKey) {
        const items = Array.isArray(json.scannerPairs) ? json.scannerPairs.slice() : []
        const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0')) || 0)
        const getMcap = (it) => {
          const cands = [it.currentMcap, it.initialMcap, it.pairMcapUsd, it.pairMcapUsdInitial]
          for (const c of cands) { const n = toNum(c); if (n > 0) return n }
          return 0
        }
        const getVal = (it) => {
          switch (sortKey) {
            case 'tokenName': return String(it.token1Name || '')
            case 'exchange': return String(it.routerAddress || it.virtualRouterType || it.migratedFromVirtualRouter || '')
            case 'price':
            case 'priceUsd': return toNum(it.price)
            case 'mcap': return getMcap(it)
            case 'volume':
            case 'volumeUsd': return toNum(it.volume)
            case 'age': return new Date(it.age).getTime() || 0
            case 'tx': return toNum(it.txns)
            case 'liquidity': return toNum(it.liquidity)
            default: return 0
          }
        }
        items.sort((a, b) => {
          const va = getVal(a)
          const vb = getVal(b)
          let cmp
          if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb)
          else cmp = (va < vb) ? -1 : (va > vb) ? 1 : 0
          return sortDir === 'asc' ? cmp : -cmp
        })
        json.scannerPairs = items
      }
    } catch { /* ignore sorting errors, return unsorted */ }

    res.type('application/json').send(json)
  })

  // Healthcheck
  app.get('/healthz', (_req, res) => res.send('ok'))

  return app
}
