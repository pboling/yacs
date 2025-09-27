import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'

// NOTE: server imports are intentionally dynamic inside start() to avoid resolution
// when the test is skipped and the server files are not present.
async function start() {
  const { createApp } = await import('../server/scanner.server.js')
  const { attachWsServer } = await import('../server/ws.server.js')
  // Accelerate WS timing during tests so we don't wait seconds between ticks
  process.env.TEST_FAST = '1'

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

function waitForEvent(ws, event, timeoutMs = 8000) {
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
import { withDeterministicTimeout } from './utils/testUtils.js'

test.skip('WebSocket: scanner subscribe yields scanner-pairs, then changing deterministic ticks and pair-stats', async () => {
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

      const pairsMsg = await waitForEvent(ws, 'scanner-pairs')
      assert.equal(typeof pairsMsg.data.page, 'number')
      assert.ok(Array.isArray(pairsMsg.data.scannerPairs))
      assert.ok(pairsMsg.data.scannerPairs.length > 0)

      const first = pairsMsg.data.scannerPairs[0]
      // Subscribe explicitly to pair + pair-stats (server also emits them once per scanner-filter)
      ws.send(
        JSON.stringify({
          event: 'subscribe-pair',
          data: {
            pair: first.pairAddress,
            token: first.token1Address,
            chain: String(first.chainId),
          },
        }),
      )
      ws.send(
        JSON.stringify({
          event: 'subscribe-pair-stats',
          data: {
            pair: first.pairAddress,
            token: first.token1Address,
            chain: String(first.chainId),
          },
        }),
      )

      const tickMsg1 = await waitForEvent(ws, 'tick')
      assert.equal(typeof tickMsg1.data.pair.pair, 'string')
      assert.ok(Array.isArray(tickMsg1.data.swaps))
      assert.ok(tickMsg1.data.swaps.length >= 1)
      const latest1 = tickMsg1.data.swaps.filter((s) => !s.isOutlier).pop()
      assert.ok(latest1)

      // Second tick should arrive and differ (deterministically based on seed + tick index)
      const tickMsg2 = await waitForEvent(ws, 'tick')
      const latest2 = tickMsg2.data.swaps.filter((s) => !s.isOutlier).pop()
      assert.ok(latest2)
      assert.notEqual(latest1.priceToken1Usd, latest2.priceToken1Usd)

      const statsMsg = await waitForEvent(ws, 'pair-stats')
      assert.equal(typeof statsMsg.data.pair.pairAddress, 'string')

      ws.close()
      try {
        await once(ws, 'close')
      } catch {}
    } finally {
      await new Promise((r) => server.close(r))
    }
  }, 12000)
})
