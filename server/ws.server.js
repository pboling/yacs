/*
  ws.server.js
  Local WebSocket server for development and tests.
  - Path: /ws
  - Protocol: JSON messages compatible with ws.mapper.js expectations
  - Behavior:
    • On { event: 'scanner-filter', data: { ...filters, page? } }
      → Responds with { event: 'scanner-pairs', data: { page, scannerPairs } }
      → Then emits a synthetic 'tick' and 'pair-stats' for the first pair
    • On { event: 'subscribe-pair' } or { event: 'subscribe-pair-stats' }
      → Stores interest and may emit further updates (for tests we emit once)

  This server is deterministic by delegating dataset creation to generateScannerResponse.
*/

import { WebSocketServer } from 'ws'
import { generateScannerResponse } from '../src/scanner.endpoint.js'

/**
 * Attach a WebSocket server to an existing HTTP/S server.
 * @param {import('http').Server} server
 * @returns {WebSocketServer}
 */
export function attachWsServer(server) {
    const wss = new WebSocketServer({ server, path: '/ws' })

    // Track simple subscriptions per socket
    wss.on('connection', (ws) => {
        /** @type {{ pairs: Set<string>, stats: Set<string> }} */
        const subs = { pairs: new Set(), stats: new Set() }

        ws.on('message', (buf) => {
            let msg
            try {
                msg = JSON.parse(buf.toString())
            } catch {
                return
            }
            const ev = msg?.event
            if (ev === 'scanner-filter') {
                const page = Number(msg.data?.page ?? 1) || 1
                const res = generateScannerResponse({ ...msg.data, page })
                const payload = { event: 'scanner-pairs', data: { page, scannerPairs: res.scannerPairs } }
                safeSend(ws, payload)

                // Emit one tick and pair-stats for the first item to prove pipeline works
                const first = res.scannerPairs[0]
                if (first) {
                    const pairKey = first.pairAddress + '|' + first.token1Address + '|' + String(first.chainId)
                    setTimeout(() => {
                        const tick = {
                            event: 'tick',
                            data: {
                                pair: { pair: first.pairAddress, token: first.token1Address, chain: String(first.chainId) },
                                swaps: [
                                    // include an outlier to ensure client filters it out; latest non-outlier used
                                    {
                                        isOutlier: true,
                                        priceToken1Usd: String(Number(first.price) * 0.5),
                                        tokenInAddress: first.token1Address,
                                        amountToken1: '1',
                                    },
                                    {
                                        isOutlier: false,
                                        priceToken1Usd: String(Math.max(0.000001, Number(first.price) * 1.02)),
                                        tokenInAddress: first.token1Address, // treat as a sell for diversity
                                        amountToken1: '3.5',
                                    },
                                ],
                            },
                        }
                        safeSend(ws, tick)
                    }, 50)

                    setTimeout(() => {
                        const stats = {
                            event: 'pair-stats',
                            data: {
                                pair: {
                                    pairAddress: first.pairAddress,
                                    token1IsHoneypot: false,
                                    isVerified: true,
                                    mintAuthorityRenounced: true,
                                    freezeAuthorityRenounced: true,
                                },
                            },
                        }
                        safeSend(ws, stats)
                    }, 100)
                    subs.pairs.add(pairKey)
                    subs.stats.add(pairKey)
                }
            } else if (ev === 'subscribe-pair') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.pairs.add(key)
            } else if (ev === 'subscribe-pair-stats') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.stats.add(key)
            }
        })

        ws.on('close', () => {
            subs.pairs.clear()
            subs.stats.clear()
        })
    })

    return wss
}

function safeSend(ws, obj) {
    if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)) } catch { /* ignore */ }
    }
}
