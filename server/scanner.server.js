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

    const json = generateScannerResponse(norm)
    res.type('application/json').send(json)
  })

  // Healthcheck
  app.get('/healthz', (_req, res) => res.send('ok'))

  return app
}
