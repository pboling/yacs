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

// Timing configuration is resolved at runtime (not module load) so tests can set TEST_FAST before attaching the WS server.
function getTiming() {
    const FAST_TIMING = (process && process.env && process.env.TEST_FAST === '1')
    return {
        FAST_TIMING,
        TICK_INTERVAL_MS: FAST_TIMING ? 5 : 1000,
        MAX_STAGGER_MS: FAST_TIMING ? 0 : 1000,
    }
}

/**
 * Attach a WebSocket server to an existing HTTP/S server.
 * @param {import('http').Server} server
 * @returns {WebSocketServer}
 */
export function attachWsServer(server) {
    const wss = new WebSocketServer({ server, path: '/ws' })

    // Ensure the WS server is closed when the underlying HTTP server closes,
    // so Node's test runner can exit cleanly without lingering handles.
    try {
        server.on('close', () => {
            try {
                // Proactively terminate all clients to ensure their timers are cleared and close events fire
                for (const client of wss.clients) {
                    try { client.terminate() } catch { /* ignore */ }
                }
                wss.close()
            } catch { /* ignore close errors */ }
        })
    } catch { /* no-op */ }

    // Track simple subscriptions per socket
    wss.on('connection', (ws) => {
        // Avoid unhandled error events keeping the process alive in tests
        try { ws.on('error', () => {}) } catch { /* no-op */ }
        /** @type {{ pairsFast: Set<string>, pairsSlow: Set<string>, statsFast: Set<string>, statsSlow: Set<string> }} */
        const subs = { pairsFast: new Set(), pairsSlow: new Set(), statsFast: new Set(), statsSlow: new Set() }
        /** @type {Map<string, NodeJS.Timeout>} */
        const tickTimers = new Map()
        /** @type {Map<string, NodeJS.Timeout>} */
        const warmupTimers = new Map()
        /** @type {Map<string, any>} */
        const itemsByKey = new Map()
        const BASE_SEED = getBaseSeed()
                // Resolve timing for this connection (reads env at runtime)
                const { TICK_INTERVAL_MS, MAX_STAGGER_MS } = getTiming()
        // Default slow factor fallback; overridden per-key using dynamic ratio to total rows
        const DEFAULT_SLOW_FACTOR = 50
        /** @type {Map<string, number>} */
        const slowFactorByKey = new Map()

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
            return Number(p.toFixed(8))
        }
        function computeAmount(pairKey, tickIndex) {
            const seed = mixSeeds(BASE_SEED, mixSeeds(hash32(pairKey) ^ 0x9e3779b9, tickIndex >>> 0))
            const rnd = mulberry32(seed)
            return Number((rnd() * 10).toFixed(3)) || 0.001
        }
        function computeSlowFactor() {
            const total = itemsByKey.size || 1
            // Variable rate grows with table size so non-visible rows update less frequently as dataset grows
            // Example mapping: 0-200 rows → 50; 400 → 100; 800 → 200, etc.
            return Math.max(DEFAULT_SLOW_FACTOR, Math.ceil(total / 4))
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
                // Determine a plausible token0 address per chain for buy classification
                const chainId = Number(item.chainId)
                const token0Address = (chainId === 56)
                    ? '0xWBNB'
                    : (chainId === 900)
                        ? 'So11111111111111111111111111111111111111112'
                        : '0xWETH'
                const isBuyTick = (n % 2) === 1 // odd ticks → buys (token0 in), even ticks → sells (token1 in)
                const key = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
                const isFast = subs.pairsFast.has(key)
                const isSlow = subs.pairsSlow.has(key)
                if (isFast || isSlow) {
                    const slowFactor = slowFactorByKey.get(key) ?? DEFAULT_SLOW_FACTOR
                    const shouldSendTick = isFast || (isSlow && (n % slowFactor === 0))
                    if (shouldSendTick) {
                        const tick = {
                            event: 'tick',
                            data: {
                                pair: { pair: item.pairAddress, token: item.token1Address, chain: String(item.chainId) },
                                swaps: [
                                    { isOutlier: true, priceToken1Usd: String(Math.max(0.000001, basePrice * 0.5)), tokenInAddress: item.token1Address, amountToken1: '1', token0Address },
                                    { isOutlier: false, priceToken1Usd: String(price), tokenInAddress: isBuyTick ? token0Address : item.token1Address, amountToken1: amt, token0Address },
                                ],
                            },
                        }
                        safeSend(ws, tick)
                    }
                    const isStatsFast = subs.statsFast.has(key)
                    const isStatsSlow = subs.statsSlow.has(key)
                    if (isStatsFast || isStatsSlow) {
                        const slowFactorStats = slowFactorByKey.get(key) ?? DEFAULT_SLOW_FACTOR
                        const shouldSendStats = isStatsFast ? (n % 2 === 0) : (n % slowFactorStats === 0)
                        if (shouldSendStats) {
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
                }
            }

            // Stagger the first emission based on pairKey to avoid synchronized updates
            const initialDelay = hash32(pairKey) % (MAX_STAGGER_MS + 1) // up to MAX_STAGGER_MS
            const warm = setTimeout(() => {
                warmupTimers.delete(pairKey)
                sendTick()
                const interval = setInterval(sendTick, TICK_INTERVAL_MS)
                // Prevent this interval from keeping the event loop alive if tests forget to close
                if (typeof (interval).unref === 'function') {
                    try { (interval).unref() } catch { /* no-op */ }
                }
                tickTimers.set(pairKey, interval)
            }, initialDelay)
            // Prevent this timer from keeping the event loop alive
            if (typeof (warm).unref === 'function') {
                try { (warm).unref() } catch { /* no-op */ }
            }
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

                // Begin deterministic streams for the first few items to ensure visible rows update quickly
                const bootstrapCount = 6
                for (let i = 0; i < Math.min(bootstrapCount, res.scannerPairs.length); i++) {
                    const item = res.scannerPairs[i]
                    if (!item) continue
                    const pairKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
                    subs.pairsFast.add(pairKey)
                    subs.statsFast.add(pairKey)
                    startStreamFor(item)
                }

                // After initial dataset, periodically emit new tokens for this page (scanner-append)
                // so clients can exercise real-time insertion + sorting behavior.
                let appendIndex = 0
                const appendKey = 'append|' + String(page)
                if (!tickTimers.has(appendKey)) {
                    const appendIntervalMs = Math.max(100, Math.min(2000, TICK_INTERVAL_MS * 10))
                    const interval = setInterval(() => {
                        appendIndex++
                        // Generate a deterministic different page to get a distinct set of items
                        const gen = generateScannerResponse({ ...msg.data, page: page + 10_000 + appendIndex })
                        // Pick the first item that is not already known by pair+token+chain
                        let newItem = null
                        for (const cand of gen.scannerPairs) {
                            const k = cand.pairAddress + '|' + cand.token1Address + '|' + String(cand.chainId)
                            if (!itemsByKey.has(k)) { newItem = cand; break }
                        }
                        if (!newItem) return
                        const pairKey2 = newItem.pairAddress + '|' + newItem.token1Address + '|' + String(newItem.chainId)
                        itemsByKey.set(pairKey2, newItem)
                        // Emit append event
                        safeSend(ws, { event: 'scanner-append', data: { page, scannerPairs: [newItem] } })
                        // Auto-subscribe streams for the new item so it starts updating in UI
                        subs.pairsFast.add(pairKey2)
                        subs.statsFast.add(pairKey2)
                        startStreamFor(newItem)
                    }, appendIntervalMs)
                    try { (interval).unref && (interval).unref() } catch { /* no-op */ }
                    tickTimers.set(appendKey, interval)
                }
            } else if (ev === 'subscribe-pair') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.pairsFast.add(key)
                subs.pairsSlow.delete(key)
                slowFactorByKey.delete(key)
                let item = itemsByKey.get(key)
                if (!item) {
                    // Be tolerant to chain format mismatches (e.g., 'ETH' vs '1'): try to resolve by pair+token only
                    let prefix = p?.pair + '|' + p?.token + '|'
                    for (const [k, v] of itemsByKey.entries()) {
                        if (typeof k === 'string' && k.startsWith(prefix)) { item = v; break }
                    }
                    // Fallback: match by pair only if token differs between sources
                    if (!item) {
                        prefix = p?.pair + '|'
                        for (const [k, v] of itemsByKey.entries()) {
                            if (typeof k === 'string' && k.startsWith(prefix)) { item = v; break }
                        }
                    }
                }
                if (!item && p && p.pair && p.token) {
                    // As a last resort, construct a minimal stub so the stream can start deterministically.
                    const toId = (c) => {
                        const n = Number(c)
                        if (Number.isFinite(n)) return n
                        const s = String(c || '').toUpperCase()
                        if (s === 'ETH') return 1
                        if (s === 'BSC') return 56
                        if (s === 'BASE') return 8453
                        if (s === 'SOL') return 900
                        return 1
                    }
                    const chainId = toId(p.chain)
                    item = {
                        pairAddress: String(p.pair),
                        token1Address: String(p.token),
                        chainId,
                        // Provide a tiny non-zero price for deterministic stream generation
                        price: '1.0',
                    }
                    // Index the stub so stats subscription can also find it
                    const stubKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
                    itemsByKey.set(stubKey, item)
                }
                if (item) startStreamFor(item)
            } else if (ev === 'subscribe-pair-slow') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.pairsSlow.add(key)
                subs.pairsFast.delete(key)
                slowFactorByKey.set(key, computeSlowFactor())
                let item = itemsByKey.get(key)
                if (!item && p && p.pair && p.token) {
                    const toId = (c) => {
                        const n = Number(c)
                        if (Number.isFinite(n)) return n
                        const s = String(c || '').toUpperCase()
                        if (s === 'ETH') return 1
                        if (s === 'BSC') return 56
                        if (s === 'BASE') return 8453
                        if (s === 'SOL') return 900
                        return 1
                    }
                    const chainId = toId(p.chain)
                    item = { pairAddress: String(p.pair), token1Address: String(p.token), chainId, price: '1.0' }
                    const stubKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
                    itemsByKey.set(stubKey, item)
                }
                if (item) startStreamFor(item)
            } else if (ev === 'unsubscribe-pair') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.pairsFast.delete(key)
                subs.pairsSlow.delete(key)
                slowFactorByKey.delete(key)
            } else if (ev === 'subscribe-pair-stats') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.statsFast.add(key)
                subs.statsSlow.delete(key)
                slowFactorByKey.delete(key)
                // If only stats subscription arrives first, also start stream so that stats get emitted too
                let item = itemsByKey.get(key)
                if (!item) {
                    let prefix = p?.pair + '|' + p?.token + '|'
                    for (const [k, v] of itemsByKey.entries()) {
                        if (typeof k === 'string' && k.startsWith(prefix)) { item = v; break }
                    }
                    if (!item) {
                        prefix = p?.pair + '|'
                        for (const [k, v] of itemsByKey.entries()) {
                            if (typeof k === 'string' && k.startsWith(prefix)) { item = v; break }
                        }
                    }
                }
                if (!item && p && p.pair && p.token) {
                    const toId = (c) => {
                        const n = Number(c)
                        if (Number.isFinite(n)) return n
                        const s = String(c || '').toUpperCase()
                        if (s === 'ETH') return 1
                        if (s === 'BSC') return 56
                        if (s === 'BASE') return 8453
                        if (s === 'SOL') return 900
                        return 1
                    }
                    const chainId = toId(p.chain)
                    item = {
                        pairAddress: String(p.pair),
                        token1Address: String(p.token),
                        chainId,
                        price: '1.0',
                    }
                    const stubKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
                    itemsByKey.set(stubKey, item)
                }
                if (item) startStreamFor(item)
            } else if (ev === 'subscribe-pair-stats-slow') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.statsSlow.add(key)
                subs.statsFast.delete(key)
                slowFactorByKey.set(key, computeSlowFactor())
                // If only stats-slow arrives first, also start stream
                let item = itemsByKey.get(key)
                if (!item && p && p.pair && p.token) {
                    const toId = (c) => {
                        const n = Number(c)
                        if (Number.isFinite(n)) return n
                        const s = String(c || '').toUpperCase()
                        if (s === 'ETH') return 1
                        if (s === 'BSC') return 56
                        if (s === 'BASE') return 8453
                        if (s === 'SOL') return 900
                        return 1
                    }
                    const chainId = toId(p.chain)
                    item = { pairAddress: String(p.pair), token1Address: String(p.token), chainId, price: '1.0' }
                    const stubKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
                    itemsByKey.set(stubKey, item)
                }
                if (item) startStreamFor(item)
            } else if (ev === 'unsubscribe-pair-stats') {
                const p = msg.data
                const key = p?.pair + '|' + p?.token + '|' + p?.chain
                subs.statsFast.delete(key)
                subs.statsSlow.delete(key)
                slowFactorByKey.delete(key)
            }
        })

        ws.on('close', () => {
            subs.pairsFast.clear()
            subs.pairsSlow.clear()
            subs.statsFast.clear()
            subs.statsSlow.clear()
            for (const t of warmupTimers.values()) clearTimeout(t)
            warmupTimers.clear()
            for (const t of tickTimers.values()) clearInterval(t)
            tickTimers.clear()
            slowFactorByKey.clear()
        })
    })

    return wss
}

function safeSend(ws, obj) {
    if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)) } catch { /* ignore */ }
    }
}
