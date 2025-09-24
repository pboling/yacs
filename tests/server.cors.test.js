import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'

import { createApp } from '../server/scanner.server.js'

async function startServer(app) {
  const server = http.createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const addr = server.address()
  const urlBase = `http://${addr.address}:${addr.port}`
  return { server, urlBase }
}

async function get(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.headers || {},
  })
  return res
}

// Regression: Ensure backend sets CORS headers so browsers don't throw "Failed to fetch"
test('GET /scanner includes CORS headers when Origin is provided', async () => {
  const app = createApp()
  const { server, urlBase } = await startServer(app)
  try {
    const url = `${urlBase}/scanner?page=1&chain=ETH`
    const res = await get(url, { headers: { Origin: 'http://localhost:5173' } })
    assert.equal(res.status, 200)
    const acao = res.headers.get('access-control-allow-origin')
    assert.ok(acao, 'Access-Control-Allow-Origin header should be present')
    // Allow wildcard to keep things simple in dev
    assert.equal(acao, '*')
    const ct = res.headers.get('content-type')
    assert.ok(ct && ct.includes('application/json'))
  } finally {
    server.close()
  }
})
