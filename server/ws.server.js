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
import { getBaseSeed, mixSeeds } from '../src/seed.util.js'

// Test-time acceleration: when TEST_FAST=1, collapse delays/intervals so tests don't wait seconds.
const FAST_TIMING = (process.env && process.env.TEST_FAST === '1')
const TICK_INTERVAL_MS = FAST_TIMING ? 5 : 1000
const MAX_STAGGER_MS = FAST_TIMING ? 0 : 1000

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
        /** @type {Map<string, NodeJS.Timeout>} */
        const tickTimers = new Map()
        /** @type {Map<string, NodeJS.Timeout>} */
        const warmupTimers = new Map()
        /** @type {Map<string, any>} */
        const itemsByKey = new Map()
        const BASE_SEED = getBaseSeed()

        function hash32(str) {
            let h = 2166136261 >>> 0
            for (let i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i)
                h = Math.imul(h, 16777619)
            }
            return h >>> 0
        }
        function mulberry32(seed) {
            let t = seed >>> 0
            return function () {
                t += 0x6D2B79F5
                let r = Math.imul(t ^ t >>> 15, 1 | t)
                r ^= r + Math.imul(r ^ r >>> 7, 61 | r)
                return ((r ^ r >>> 14) >>> 0) / 4294967296
            }
        }
        function computePrice(basePrice, pairKey, tickIndex) {
            const seed = mixSeeds(BASE_SEED, mixSeeds(hash32(pairKey), tickIndex >>> 0))
            const rnd = mulberry32(seed)
            // smooth-ish drift in +-3%
            const drift = (rnd() * 2 - 1) * 0.03
            const p = Math.max(0.000001, basePrice * (1 + drift))
            return Number(p.toFixed(6))
        }
        function computeAmount(pairKey, tickIndex) {
            const seed = mixSeeds(BASE_SEED, mixSeeds(hash32(pairKey) ^ 0x9e3779b9, tickIndex >>> 0))
            const rnd = mulberry32(seed)
            return Number((rnd() * 10).toFixed(3)) || 0.001
        }
        function startStreamFor(item) {
            const pairKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
            if (tickTimers.has(pairKey) || warmupTimers.has(pairKey)) return
            let n = 0
            const basePrice = Number(item.price)

            const sendTick = () => {
                n++
                const price = computePrice(basePrice, pairKey, n)
                const amt = String(computeAmount(pairKey, n))
                const tick = {
                    event: 'tick',
                    data: {
                        pair: { pair: item.pairAddress, token: item.token1Address, chain: String(item.chainId) },
                        swaps: [
                            { isOutlier: true, priceToken1Usd: String(Math.max(0.000001, basePrice * 0.5)), tokenInAddress: item.token1Address, amountToken1: '1' },
                            { isOutlier: false, priceToken1Usd: String(price), tokenInAddress: item.token1Address, amountToken1: amt },
                        ],
                    },
                }
                safeSend(ws, tick)
                // Emit pair-stats derived from seed + tick more frequently so tests don't time out
                if (n % 2 === 0) {
                    const ver = ((hash32(pairKey) + n) & 1) === 0
                    const hp = ((hash32(pairKey) ^ n) & 3) === 0
                    const stats = {
                        event: 'pair-stats',
                        data: {
                            pair: {
                                pairAddress: item.pairAddress,
                                token1IsHoneypot: hp,
                                isVerified: ver,
                                mintAuthorityRenounced: true,
                                freezeAuthorityRenounced: true,
                            },
                        },
                    }
                    safeSend(ws, stats)
                }
            }

            // Stagger the first emission based on pairKey to avoid synchronized updates
            const initialDelay = hash32(pairKey) % (MAX_STAGGER_MS + 1) // up to MAX_STAGGER_MS
            const warm = setTimeout(() => {
                warmupTimers.delete(pairKey)
                sendTick()
                const interval = setInterval(sendTick, TICK_INTERVAL_MS)
                tickTimers.set(pairKey, interval)
            }, initialDelay)
            warmupTimers.set(pairKey, warm)
        }

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

                // Index all items by pair key so later subscribe-pair can start their streams
                for (const item of res.scannerPairs) {
                    const key = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
                    itemsByKey.set(key, item)
                }

                // Begin deterministic stream for the first item (kept for immediate UI feedback)
                const first = res.scannerPairs[0]
                if (first) {
                    const pairKey = first.pairAddress + '|' + first.token1Address + '|' + String(first.chainId)
                    subs.pairs.add(pairKey)
                    subs.stats.add(pairKey)
                    startStreamFor(first)
                }
            } else if (ev === 'subscribe-pair') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.pairs.add(key)
                const item = itemsByKey.get(key)
                if (item) startStreamFor(item)
            } else if (ev === 'subscribe-pair-stats') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.stats.add(key)
                // If only stats subscription arrives first, also start stream so that stats get emitted too
                const item = itemsByKey.get(key)
                if (item) startStreamFor(item)
            }
        })

        ws.on('close', () => {
            subs.pairs.clear()
            subs.stats.clear()
            for (const t of warmupTimers.values()) clearTimeout(t)
            warmupTimers.clear()
            for (const t of tickTimers.values()) clearInterval(t)
            tickTimers.clear()
        })
    })

    return wss
}

function safeSend(ws, obj) {
    if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)) } catch { /* ignore */ }
    }
}
