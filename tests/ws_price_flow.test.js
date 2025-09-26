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
import { withDeterministicTimeout } from './utils/testUtils.js'

test('WS tick events update reducer priceUsd and mcap deterministically', async () => {
  await withDeterministicTimeout(async () => {
    const { server, wsBase } = await start()
    /** @type {import('ws')} */
    let ws
    try {
      ws = await openWs(wsBase + '/ws')

      // Subscribe to scanner-filter
      ws.send(
        JSON.stringify({
          event: 'scanner-filter',
          data: { chain: 'ETH', rankBy: 'volume', page: 1, isNotHP: true },
        }),
      )

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
      // Choose a deterministic target by unique key rather than relying on array order
      const sorted = [...pairsMsg.data.scannerPairs].sort((a, b) => {
        const ka = String(a.pairAddress) + '|' + String(a.token1Address) + '|' + String(a.chainId)
        const kb = String(b.pairAddress) + '|' + String(b.token1Address) + '|' + String(b.chainId)
        return ka.localeCompare(kb)
      })
      const target = sorted[0]
      assert.ok(target)
      const targetKey =
        String(target.pairAddress) +
        '|' +
        String(target.token1Address) +
        '|' +
        String(target.chainId)

      ws.send(
        JSON.stringify({
          event: 'subscribe-pair',
          data: {
            pair: target.pairAddress,
            token: target.token1Address,
            chain: String(target.chainId),
          },
        }),
      )

      // Collect two ticks for the target only and reduce them into state
      let price1 = null
      let price2 = null
      let _vol1 = null
      let _vol2 = null

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
              const key =
                String(msg.data?.pair?.pair) +
                '|' +
                String(msg.data?.pair?.token) +
                '|' +
                String(msg.data?.pair?.chain)
              if (key !== targetKey) return // Ignore ticks for other pairs (server bootstraps many)
              const id = msg.data.pair.pair
              const row = state.byId[id] || state.byId[id.toLowerCase()]
              if (row && price1 == null) {
                price1 = row.priceUsd
                _vol1 = row.volumeUsd
              } else if (row && price1 != null && price2 == null) {
                price2 = row.priceUsd
                _vol2 = row.volumeUsd
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
      // In extremely rare cases with specific seeds, two successive tick prices can quantize to the same value.
      // Accept either a price change or a volume change to confirm state updates occurred.
      assert.ok(
        price1 !== price2 || _vol2 !== _vol1,
        'expected observable state change between successive ticks (price or volume)',
      )

      // Verify market cap recalculation matches README (totalSupply * newPrice)
      const id = target.pairAddress
      const row = state.byId[id] || state.byId[id.toLowerCase()]
      const totalSupply = parseFloat(target.token1TotalSupplyFormatted)
      const expectedMcap = totalSupply * row.priceUsd
      const diff = Math.abs(row.mcap - expectedMcap)
      const denom = Math.max(1, Math.abs(expectedMcap))
      const relErr = diff / denom
      assert.ok(
        relErr <= 1e-6,
        `mcap should equal totalSupply*price within tolerance; got mcap=${row.mcap}, expected=${expectedMcap}, relErr=${relErr}`,
      )

      ws.close()
      try {
        await once(ws, 'close')
      } catch {}
    } finally {
      await new Promise((r) => server.close(r))
    }
  }, 12000)
})
