import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'

import { createApp } from '../server/scanner.server.js'
import { attachWsServer } from '../server/ws.server.js'

async function start() {
    const app = createApp()
    const server = http.createServer(app)
    attachWsServer(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const addr = server.address()
    const base = `http://${addr.address}:${addr.port}`
    const wsBase = `ws://${addr.address}:${addr.port}`
    return { server, base, wsBase }
}

function openWs(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url)
        ws.once('open', () => resolve(ws))
        ws.once('error', reject)
    })
}

function waitForEvent(ws, event, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('timeout waiting for ' + event)), timeoutMs)
        function onMessage(raw) {
            try {
                const msg = JSON.parse(raw.toString())
                if (msg && msg.event === event) {
                    clearTimeout(to)
                    ws.off('message', onMessage)
                    resolve(msg)
                }
            } catch {}
        }
        ws.on('message', onMessage)
    })
}

// Integration: WS handshake, scanner subscription, then server pushes data and per-pair updates
// This validates our client/server WS contract at a protocol level.
test('WebSocket: scanner subscribe yields scanner-pairs followed by tick and pair-stats', async () => {
    const { server, wsBase } = await start()
    try {
        const ws = await openWs(wsBase + '/ws')

        // Subscribe to scanner-filter
        ws.send(JSON.stringify({ event: 'scanner-filter', data: { chain: 'ETH', rankBy: 'volume', page: 1, isNotHP: true } }))

        const pairsMsg = await waitForEvent(ws, 'scanner-pairs')
        assert.equal(typeof pairsMsg.data.page, 'number')
        assert.ok(Array.isArray(pairsMsg.data.scannerPairs))
        assert.ok(pairsMsg.data.scannerPairs.length > 0)

        const first = pairsMsg.data.scannerPairs[0]
        // Subscribe explicitly to pair + pair-stats (server also emits them once per scanner-filter)
        ws.send(JSON.stringify({ event: 'subscribe-pair', data: { pair: first.pairAddress, token: first.token1Address, chain: String(first.chainId) } }))
        ws.send(JSON.stringify({ event: 'subscribe-pair-stats', data: { pair: first.pairAddress, token: first.token1Address, chain: String(first.chainId) } }))

        const tickMsg = await waitForEvent(ws, 'tick')
        assert.equal(typeof tickMsg.data.pair.pair, 'string')
        assert.ok(Array.isArray(tickMsg.data.swaps))
        assert.ok(tickMsg.data.swaps.length >= 1)

        const statsMsg = await waitForEvent(ws, 'pair-stats')
        assert.equal(typeof statsMsg.data.pair.pairAddress, 'string')

        ws.close()
    } finally {
        server.close()
    }
})
