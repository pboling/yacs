import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'

import { createApp } from '../server/scanner.server.js'
import { attachWsServer } from '../server/ws.server.js'
import { tokensReducer, initialState } from '../src/tokens.reducer.js'
import { mapIncomingMessageToAction } from '../src/ws.mapper.js'

async function start() {
    process.env.TEST_FAST = '1'
    const app = createApp()
    const server = http.createServer(app)
    attachWsServer(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const addr = server.address()
    const wsBase = `ws://${addr.address}:${addr.port}`
    return { server, wsBase }
}

function openWs(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url)
        ws.once('open', () => resolve(ws))
        ws.once('error', reject)
    })
}

function waitForEvents(ws, count, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const out = []
        const to = setTimeout(() => reject(new Error('timeout waiting for events')), timeoutMs)
        function onMessage(raw) {
            try {
                const msg = JSON.parse(raw.toString())
                out.push(msg)
                if (out.length >= count) {
                    clearTimeout(to)
                    ws.off('message', onMessage)
                    resolve(out)
                }
            } catch {}
        }
        ws.on('message', onMessage)
    })
}

// End-to-end state flow: WS scanner → subscribe pair → ticks → reducer state updates price & mcap
// Also validates deterministic change across ticks (seed + tick index)
test('WS tick events update reducer priceUsd and mcap deterministically', async () => {
    const { server, wsBase } = await start()
    try {
        const ws = await openWs(wsBase + '/ws')

        // Subscribe to scanner-filter
        ws.send(JSON.stringify({ event: 'scanner-filter', data: { chain: 'ETH', rankBy: 'volume', page: 1, isNotHP: true } }))

        // Wait for initial scanner-pairs then subscribe explicitly to the first pair
        let state = initialState

        const events = await waitForEvents(ws, 1)
        const pairsMsg = events.find((e) => e.event === 'scanner-pairs')
        assert.ok(pairsMsg)
        // Initialize reducer state with scanner-pairs so subsequent ticks can update rows
        const initAction = mapIncomingMessageToAction(pairsMsg)
        if (initAction) {
            state = tokensReducer(state, initAction)
        }
        const first = pairsMsg.data.scannerPairs[0]
        assert.ok(first)

        ws.send(JSON.stringify({ event: 'subscribe-pair', data: { pair: first.pairAddress, token: first.token1Address, chain: String(first.chainId) } }))

        // Collect two ticks and reduce them into state
        let price1 = null
        let price2 = null
        let vol1 = null
        let vol2 = null

        await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error('timeout waiting for ticks')), 8000)
            function onMessage(raw) {
                try {
                    const msg = JSON.parse(raw.toString())
                    const action = mapIncomingMessageToAction(msg)
                    if (action) {
                        state = tokensReducer(state, action)
                    }
                    if (msg.event === 'tick') {
                        const id = msg.data.pair.pair
                        const row = state.byId[id] || state.byId[id.toLowerCase()]
                        if (row && price1 == null) {
                            price1 = row.priceUsd
                            vol1 = row.volumeUsd
                        } else if (row && price1 != null && price2 == null) {
                            price2 = row.priceUsd
                            vol2 = row.volumeUsd
                            clearTimeout(to)
                            ws.off('message', onMessage)
                            resolve(null)
                        }
                    }
                } catch {}
            }
            ws.on('message', onMessage)
        })

        assert.ok(typeof price1 === 'number' && price1 > 0)
        assert.ok(typeof price2 === 'number' && price2 > 0)
        assert.notEqual(price1, price2, 'expected deterministic drift between ticks')

        // Verify market cap recalculation matches README (totalSupply * newPrice)
        const id = pairsMsg.data.scannerPairs[0].pairAddress
        const row = state.byId[id] || state.byId[id.toLowerCase()]
        const totalSupply = parseFloat(first.token1TotalSupplyFormatted)
        assert.equal(row.mcap, totalSupply * row.priceUsd)

        ws.close()
    } finally {
        server.close()
    }
})
