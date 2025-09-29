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
  // Timing model (see also sendTick below):
  // - TICK_INTERVAL_MS sets the base cadence at which we evaluate whether to emit updates
  //   for all active subscriptions (both normal/"fast" and "slow"). Fast subs evaluate
  //   and emit on every tick; slow subs only emit every Nth tick (N = slowFactor).
  // - MAX_STAGGER_MS controls how much we randomly delay the very first emission per
  //   subscription key to avoid all rows updating at the same moment. We hash the key and
  //   mod by MAX_STAGGER_MS to get a deterministic stagger in [0..MAX_STAGGER_MS]. After the
  //   warm-up delay, all subsequent evaluations happen every TICK_INTERVAL_MS.
  // - When TEST_FAST=1 (used by node tests/e2e), we tighten the loop: TICK_INTERVAL_MS=5ms
  //   and MAX_STAGGER_MS=0 so tests run quickly and deterministically.
  // - Additionally, the default slow subscription factor is minimized to 1 under TEST_FAST
  //   so that slow subscriptions emit on every evaluation during tests.
  const FAST_TIMING = process && process.env && process.env.TEST_FAST === '1'
  return {
    FAST_TIMING,
    TICK_INTERVAL_MS: FAST_TIMING ? 5 : 3000,
    MAX_STAGGER_MS: FAST_TIMING ? 0 : 3000,
    // Control the base slow cadence; higher in dev, 1 in tests for responsiveness
    DEFAULT_SLOW_FACTOR: FAST_TIMING ? 1 : 600,
  }
}

/**
 * Attach a WebSocket server to an existing HTTP/S server.
 * @param {import('http').Server} server
 * @returns {WebSocketServer}
 */
export function attachWsServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' })

  // Proactively close WS server when HTTP server.close() is invoked to avoid hanging tests.
  try {
    const origClose = server.close.bind(server)
    server.close = (...args) => {
      try {
        for (const client of wss.clients) {
          try {
            client.terminate()
          } catch {
            /* ignore */
          }
        }
        try {
          wss.close()
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
      // @ts-ignore - preserve callback signature
      return origClose(...args)
    }
  } catch {
    /* no-op */
  }

  // Ensure the WS server is closed when the underlying HTTP server closes,
  // so Node's test runner can exit cleanly without lingering handles.
  try {
    server.on('close', () => {
      try {
        // Proactively terminate all clients to ensure their timers are cleared and close events fire
        for (const client of wss.clients) {
          try {
            client.terminate()
          } catch {
            /* ignore */
          }
        }
        wss.close()
      } catch {
        /* ignore close errors */
      }
    })
  } catch {
    /* no-op */
  }

  // Track simple subscriptions per socket
  wss.on('connection', (ws) => {
    // Avoid unhandled error events keeping the process alive in tests
    try {
      ws.on('error', () => {})
    } catch {
      /* no-op */
    }
    /** @type {{ pairsFast: Set<string>, pairsSlow: Set<string>, statsFast: Set<string>, statsSlow: Set<string> }} */
    const subs = {
      pairsFast: new Set(),
      pairsSlow: new Set(),
      statsFast: new Set(),
      statsSlow: new Set(),
    }
    /** @type {Map<string, NodeJS.Timeout>} */
    const tickTimers = new Map()
    /** @type {Map<string, NodeJS.Timeout>} */
    const warmupTimers = new Map()
    /** @type {Map<string, any>} */
    const itemsByKey = new Map()
    const BASE_SEED = getBaseSeed()
    // Resolve timing for this connection (reads env at runtime)
    const { TICK_INTERVAL_MS, MAX_STAGGER_MS, DEFAULT_SLOW_FACTOR } = getTiming()
    // Default slow factor fallback; overridden per-key using dynamic ratio to total rows
    /** @type {Map<string, number>} */
    const slowFactorByKey = new Map()
    /** @type {Map<string, number>} */
    const fastMultiplierByKey = new Map()

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
        t += 0x6d2b79f5
        let r = Math.imul(t ^ (t >>> 15), 1 | t)
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
      }
    }
    function computePrice(basePrice, pairKey, tickIndex) {
      const seed = mixSeeds(BASE_SEED, mixSeeds(hash32(pairKey), tickIndex >>> 0))
      const rnd = mulberry32(seed)
      // smooth-ish drift in +-7%
      const drift = (rnd() * 2 - 1) * 0.07
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
      // Example mapping: 0-800 rows → 200; 1600 → 400; 3200 → 800, etc.
      return Math.max(DEFAULT_SLOW_FACTOR, Math.ceil(total / 4))
    }

    // Helper: map generator item (REST shape) to WS scanner pair shape expected by client/tests
    function chainIdToName(chainId) {
      const n = Number(chainId)
      if (n === 1) return 'ETH'
      if (n === 56) return 'BSC'
      if (n === 8453) return 'BASE'
      if (n === 900) return 'SOL'
      return 'ETH'
    }

    function mapToWsPair(it) {
      // Defensive extraction from possible mixed shapes produced by older generator
      const pairAddress = it.pairAddress || it.pair || it.id || ''
      const token1Address = it.token1Address || it.tokenAddress || it.token || ''
      const chain = chainIdToName(it.chainId ?? it.chain)
      const exchange = it.routerAddress || it.exchange || it.router || null
      const priceUsd = Number(it.price ?? it.priceUsd ?? 0) || 0
      const volumeUsd = Number(it.volume ?? it.volumeUsd ?? 0) || 0
      const mcap = Number(it.currentMcap ?? it.mcap ?? it.pairMcapUsd ?? 0) || 0
      const priceChangePcs = {
        '5m': Number(it.diff5M ?? it['5m'] ?? 0) || 0,
        '1h': Number(it.diff1H ?? it['1h'] ?? 0) || 0,
        '6h': Number(it.diff6H ?? it['6h'] ?? 0) || 0,
        '24h': Number(it.diff24H ?? it['24h'] ?? 0) || 0,
      }
      const transactions = {
        buys: Number(it.buys ?? (it.transactions && it.transactions.buys) ?? 0) || 0,
        sells: Number(it.sells ?? (it.transactions && it.transactions.sells) ?? 0) || 0,
      }
      const audit = {
        mintable: it.isMintAuthDisabled ? false : true,
        freezable: it.isFreezeAuthDisabled ? false : true,
        honeypot: !!it.honeyPot,
        contractVerified: !!it.contractVerified,
      }
      const security = {
        renounced: !!it.contractRenounced,
        locked: !!it.liquidityLocked,
      }
      const tokenCreatedTimestamp = it.age ?? it.tokenCreatedTimestamp ?? null
      const liquidity =
        typeof it.liquidity === 'object'
          ? it.liquidity
          : {
              current: Number(it.liquidity ?? 0) || 0,
              changePc: Number(it.percentChangeInLiquidity ?? 0) || 0,
            }

      return {
        id: pairAddress || token1Address,
        pairAddress,
        tokenAddress: token1Address,
        tokenSymbol: it.token1Symbol ?? it.token1Symbol ?? it.tokenSymbol ?? null,
        tokenName: it.token1Name ?? it.tokenName ?? null,
        chain,
        exchange,
        priceUsd,
        volumeUsd,
        mcap,
        priceChangePcs,
        transactions,
        audit,
        security,
        tokenCreatedTimestamp,
        liquidity,
      }
    }

    function startStreamFor(item) {
      const pairKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
      if (tickTimers.has(pairKey) || warmupTimers.has(pairKey)) return
      let n = 0
      const basePrice = Number(item.price)

      const sendTick = () => {
        // We may emit multiple logical ticks per interval when a fast multiplier is set for this key.
        const key = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
        const multiplier = fastMultiplierByKey.get(key) || 1
        const doOne = () => {
          // One global tick counter per pair stream. Every TICK_INTERVAL_MS we increment n and
          // decide what to emit per subscription type:
          //   - Normal/fast pair subscription: send a 'tick' on every increment (n=1,2,3,...).
          //   - Slow pair subscription: send a 'tick' only when n % slowFactor === 0.
          // The same pattern applies to pair-stats, but with its own indicator:
          //   - Fast stats: send on every other tick (n % 2 === 0) to emulate a different cadence
          //     from price ticks while still being derived from the same base tick.
          //   - Slow stats: send when n % slowFactorStats === 0.
          // In short: TICK_INTERVAL_MS defines the scheduler cadence; fast/slow modes gate off
          // that cadence using simple modulo checks so rates remain proportional and deterministic.
          n++
          const price = computePrice(basePrice, pairKey, n)
          const amt = String(computeAmount(pairKey, n))
          // Determine a plausible token0 address per chain for buy classification
          const chainId = Number(item.chainId)
          const token0Address =
            chainId === 56
              ? '0xWBNB'
              : chainId === 900
                ? 'So11111111111111111111111111111111111111112'
                : '0xWETH'
          const isBuyTick = n % 2 === 1 // odd ticks → buys (token0 in), even ticks → sells (token1 in)
          const isFast = subs.pairsFast.has(key)
          const isSlow = subs.pairsSlow.has(key)
          if (isFast || isSlow) {
            const slowFactor = slowFactorByKey.get(key) ?? DEFAULT_SLOW_FACTOR
            const shouldSendTick = isFast || (isSlow && n % slowFactor === 0)
            if (shouldSendTick) {
              // Emit both a buy and a sell (non-outlier) each tick so Buys and Sells counters progress deterministically
              const tick = {
                event: 'tick',
                data: {
                  pair: {
                    pair: item.pairAddress,
                    token: item.token1Address,
                    chain: String(item.chainId),
                  },
                  swaps: [
                    // Outlier used as a guard/sample; ignored by UI logic
                    {
                      isOutlier: true,
                      priceToken1Usd: String(Math.max(0.000001, basePrice * 0.5)),
                      tokenInAddress: item.token1Address,
                      amountToken1: '1',
                      token0Address,
                    },
                    // Directional swap based on tick parity
                    {
                      isOutlier: false,
                      priceToken1Usd: String(price),
                      tokenInAddress: isBuyTick ? token0Address : item.token1Address,
                      amountToken1: amt,
                      token0Address,
                    },
                    // Companion opposite-direction swap to ensure both buys and sells increment each tick
                    {
                      isOutlier: false,
                      priceToken1Usd: String(price),
                      tokenInAddress: isBuyTick ? item.token1Address : token0Address,
                      amountToken1: String(Math.max(0.001, Number(amt) * 0.7)),
                      token0Address,
                    },
                  ],
                },
              }
              safeSend(ws, tick)
            }
            const isStatsFast = subs.statsFast.has(key)
            const isStatsSlow = subs.statsSlow.has(key)
            if (isStatsFast || isStatsSlow) {
              const slowFactorStats = slowFactorByKey.get(key) ?? DEFAULT_SLOW_FACTOR
              const shouldSendStats = isStatsFast ? n % 2 === 0 : n % slowFactorStats === 0
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
        const reps = Math.max(1, multiplier | 0)
        for (let r = 0; r < reps; r++) doOne()
      }

      // Stagger the first emission based on pairKey to avoid synchronized updates
      // Warm-up and staggering:
      // - We delay the very first emission by a deterministic pseudo-random amount derived
      //   from the pairKey hash, capped by MAX_STAGGER_MS. This spreads the initial bursts
      //   so a page of 50 rows does not all fire at once when subscribing.
      // - After this delay, we schedule the recurring evaluator with setInterval at
      //   TICK_INTERVAL_MS; slow subscriptions still share the same interval but skip
      //   most evaluations via the modulo gates explained above.
      const initialDelay = hash32(pairKey) % (MAX_STAGGER_MS + 1) // up to MAX_STAGGER_MS
      const warm = setTimeout(() => {
        warmupTimers.delete(pairKey)
        sendTick()
        const interval = setInterval(sendTick, TICK_INTERVAL_MS)
        // Prevent this interval from keeping the event loop alive if tests forget to close
        if (typeof interval.unref === 'function') {
          try {
            interval.unref()
          } catch {
            /* no-op */
          }
        }
        tickTimers.set(pairKey, interval)
      }, initialDelay)
      // Prevent this timer from keeping the event loop alive
      if (typeof warm.unref === 'function') {
        try {
          warm.unref()
        } catch {
          /* no-op */
        }
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

        // Map generator items to WS-shaped pairs expected by client/tests
        const wsPairs = Array.isArray(res.scannerPairs) ? res.scannerPairs.map(mapToWsPair) : []

        // Newshape: echo filter and provide results wrapper so mapIncomingMessageToAction can read
        const payload = {
          event: 'scanner-pairs',
          data: { filter: { page }, results: { pairs: wsPairs } },
        }
        safeSend(ws, payload)

        // Index all items by pair key so later subscribe-pair can start their streams
        for (const item of res.scannerPairs) {
          const key = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
          itemsByKey.set(key, item)
        }

        // Begin deterministic streams for the first few items to ensure visible rows update quickly
        const bootstrapCount = 24
        for (let i = 0; i < Math.min(bootstrapCount, res.scannerPairs.length); i++) {
          const item = res.scannerPairs[i]
          if (!item) continue
          const pairKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
          subs.pairsFast.add(pairKey)
          subs.statsFast.add(pairKey)
          startStreamFor(item)
        }
      } else if (ev === 'subscribe-pair') {
        const p = msg.data
        const key = p?.pair + '|' + p?.token + '|' + p?.chain
        subs.pairsFast.add(key)
        subs.pairsSlow.delete(key)
        slowFactorByKey.delete(key)
        fastMultiplierByKey.delete(key)
        let item = itemsByKey.get(key)
        if (!item) {
          // Be tolerant to chain format mismatches (e.g., 'ETH' vs '1'): try to resolve by pair+token only
          let prefix = p?.pair + '|' + p?.token + '|'
          for (const [k, v] of itemsByKey.entries()) {
            if (typeof k === 'string' && k.startsWith(prefix)) {
              item = v
              break
            }
          }
          // Fallback: match by pair only if token differs between sources
          if (!item) {
            prefix = p?.pair + '|'
            for (const [k, v] of itemsByKey.entries()) {
              if (typeof k === 'string' && k.startsWith(prefix)) {
                item = v
                break
              }
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
        if (item) {
          startStreamFor(item)
          // Emit an immediate tick to avoid test flakiness and long warm-ups
          try {
            const pairKey = item.pairAddress + '|' + item.token1Address + '|' + String(item.chainId)
            let n = 1
            const basePrice = Number(item.price || '1') || 1
            const price = computePrice(basePrice, pairKey, n)
            const amt = String(computeAmount(pairKey, n))
            const chainId = Number(item.chainId)
            const token0Address =
              chainId === 56
                ? '0xWBNB'
                : chainId === 900
                  ? 'So11111111111111111111111111111111111111112'
                  : '0xWETH'
            const isBuyTick = n % 2 === 1
            const tick = {
              event: 'tick',
              data: {
                pair: {
                  pair: item.pairAddress,
                  token: item.token1Address,
                  chain: String(item.chainId),
                },
                swaps: [
                  {
                    isOutlier: true,
                    priceToken1Usd: String(Math.max(0.000001, basePrice * 0.5)),
                    tokenInAddress: item.token1Address,
                    amountToken1: '1',
                    token0Address,
                  },
                  {
                    isOutlier: false,
                    priceToken1Usd: String(price),
                    tokenInAddress: isBuyTick ? token0Address : item.token1Address,
                    amountToken1: amt,
                    token0Address,
                  },
                  {
                    isOutlier: false,
                    priceToken1Usd: String(price),
                    tokenInAddress: isBuyTick ? item.token1Address : token0Address,
                    amountToken1: String(Math.max(0.001, Number(amt) * 0.7)),
                    token0Address,
                  },
                ],
              },
            }
            safeSend(ws, tick)
            // Also schedule a second immediate follow-up to ensure at least two ticks arrive quickly for tests
            try {
              const follow = setTimeout(() => {
                try {
                  const n2 = 2
                  // Use a guaranteed slight drift to ensure tests observe a change
                  const price2 = Number(Math.max(0.000001, basePrice * 1.01).toFixed(8))
                  const amt2 = String(computeAmount(pairKey, n2))
                  const isBuyTick2 = n2 % 2 === 1
                  const tick2 = {
                    event: 'tick',
                    data: {
                      pair: {
                        pair: item.pairAddress,
                        token: item.token1Address,
                        chain: String(item.chainId),
                      },
                      swaps: [
                        {
                          isOutlier: true,
                          priceToken1Usd: String(Math.max(0.000001, basePrice * 0.5)),
                          tokenInAddress: item.token1Address,
                          amountToken1: '1',
                          token0Address,
                        },
                        {
                          isOutlier: false,
                          priceToken1Usd: String(price2),
                          tokenInAddress: isBuyTick2 ? token0Address : item.token1Address,
                          amountToken1: amt2,
                          token0Address,
                        },
                        {
                          isOutlier: false,
                          priceToken1Usd: String(price2),
                          tokenInAddress: isBuyTick2 ? item.token1Address : token0Address,
                          amountToken1: String(Math.max(0.001, Number(amt2) * 0.7)),
                          token0Address,
                        },
                      ],
                    },
                  }
                  safeSend(ws, tick2)
                } catch {}
              }, 5)
              if (typeof follow.unref === 'function') {
                try {
                  follow.unref()
                } catch {}
              }
            } catch {}
          } catch {}
        }
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
      } else if (ev === 'unsubscribe-pair') {
        const p = msg.data
        const key = p?.pair + '|' + p?.token + '|' + p?.chain
        subs.pairsFast.delete(key)
        subs.pairsSlow.delete(key)
        slowFactorByKey.delete(key)
        fastMultiplierByKey.delete(key)
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
            if (typeof k === 'string' && k.startsWith(prefix)) {
              item = v
              break
            }
          }
          if (!item) {
            prefix = p?.pair + '|'
            for (const [k, v] of itemsByKey.entries()) {
              if (typeof k === 'string' && k.startsWith(prefix)) {
                item = v
                break
              }
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
    try {
      ws.send(JSON.stringify(obj))
    } catch {
      /* ignore */
    }
  }
}
