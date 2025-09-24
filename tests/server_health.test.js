import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/scanner.server.js'

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const addr = server.address()
            if (typeof addr === 'object' && addr && 'port' in addr) {
                resolve({ server, port: addr.port })
            } else {
                reject(new Error('failed to get server address'))
            }
        })
        server.on('error', reject)
    })
}

// Basic smoke test: health endpoint

test('express server exposes /healthz', async () => {
    const app = createApp()
    const { server, port } = await listen(app)
    try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`)
        assert.equal(res.status, 200)
        const text = await res.text()
        assert.equal(text, 'ok')
    } finally {
        await new Promise((r) => server.close(r))
    }
})

// Scanner endpoint should return a JSON payload with expected shape

test('express server exposes /scanner and returns JSON payload', async () => {
    const app = createApp()
    const { server, port } = await listen(app)
    try {
        const res = await fetch(`http://127.0.0.1:${port}/scanner?chain=ETH&page=1`)
        assert.equal(res.status, 200)
        const json = await res.json()
        assert.equal(typeof json, 'object')
        assert.equal(json.page, 1)
        assert.ok(Array.isArray(json.scannerPairs))
        assert.ok(json.scannerPairs.length > 0)
    } finally {
        await new Promise((r) => server.close(r))
    }
})
