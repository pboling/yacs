/*
  scanner.endpoint.js
  Deterministic, seed-based mock data generator for GET /scanner plus a small Vite
  middleware. Used by the Express backend and tests to provide stable, realistic
  data without external dependencies.

  Key ideas:
  - Seed is derived from env or .seed file (see src/seed.util.js)
  - Request parameters influence the per-page stream while remaining reproducible
  - Shapes mimic ScannerApiResponse/ScannerResult from test-task-types.ts
*/
// Mock /scanner endpoint generator and Vite middleware/plugin (ESM)
// Provides deterministic, param-influenced mock data for development and tests.

// Deterministic PRNG (mulberry32)
/**
 * Create a fast deterministic PRNG based on mulberry32.
 *
 * - Produces a function that returns floats in [0, 1).
 * - Suitable for mock data generation where reproducibility matters.
 *
 * @param {number} seed - 32-bit integer seed.
 * @returns {() => number} Random generator function.
 */
function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Simple FNV-1a-like hash of a params object, stable across key order.
 *
 * Algorithm
 * - Stringify with sorted keys to ensure deterministic representation.
 * - Fold characters into a 32-bit accumulator with bit mixing.
 *
 * Purpose
 * - Combine with a base seed to produce page- and filter-specific streams that
 *   remain reproducible for the same inputs.
 *
 * @param {Record<string, any>} params
 * @returns {number} Unsigned 32-bit hash.
 */
function hashParams(params = {}) {
  const json = JSON.stringify(params, Object.keys(params).sort())
  let h = 2166136261
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
  }
  return h >>> 0
}

/**
 * Pick a random element from an array using provided PRNG.
 * @template T
 * @param {T[]} arr
 * @param {() => number} rnd - PRNG returning [0,1).
 * @returns {T}
 */
function pick(arr, rnd) {
  return arr[Math.floor(rnd() * arr.length)]
}

/**
 * Map a human chain name to a numeric chainId used in payloads.
 * Defaults to ETH when unknown to keep consumers simple during dev.
 * @param {string} name - 'ETH' | 'BSC' | 'BASE' | 'SOL'
 * @returns {number}
 */
function chainNameToId(name) {
  switch (name) {
    case 'ETH':
      return 1
    case 'BSC':
      return 56
    case 'BASE':
      return 8453
    case 'SOL':
      return 900
    default:
      return 1
  }
}

/**
 * Format a number with fixed 6 decimal places as a string.
 * @param {number|string} num
 * @returns {string}
 */
function toFixedStr(num) {
  return Number(num).toFixed(6)
}

/**
 * Produce a deterministic pseudo-address suffixed with a human prefix for readability.
 * The body is 0x + 38 hex chars derived via rnd(); the suffix helps test expectations.
 * @param {string} prefix - e.g., 'PAIR' | 'TKN'.
 * @param {() => number} rnd - PRNG.
 * @returns {string}
 */
function mkAddress(prefix, rnd) {
  const hex = '0123456789abcdef'
  let s = '0x'
  for (let i = 0; i < 38; i++) s += pick(hex, rnd)
  return s + prefix
}

import { getBaseSeed, mixSeeds } from './seed.util.js'
import fs from 'node:fs'

// Lazy-load and cache symbols from YAML (no external YAML parser needed for simple list)
let CACHED_SYMBOLS = null
function loadSymbols() {
  if (Array.isArray(CACHED_SYMBOLS) && CACHED_SYMBOLS.length > 0) return CACHED_SYMBOLS
  try {
    const url = new URL('./config/symbols.yaml', import.meta.url)
    const text = fs.readFileSync(url, 'utf-8')
    const lines = text.split(/\r?\n/)
    const items = []
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      // support "- VALUE" or plain JSON-style ["A","B"] if someone swaps format later
      if (line.startsWith('- ')) {
        let v = line.slice(2).trim()
        // strip quotes if present
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1)
        }
        if (v) items.push(v)
      }
    }

    // Decide how to interpret the YAML items:
    // 1) If items are already full symbols with numeric suffix (e.g., apple0001) and we have enough, use as-is.
    const allAlpha = items.every((w) => /^[A-Za-z]+$/.test(w))
    const allFive = allAlpha && items.every((w) => w.length === 5)
    const allFiveWithSuffix = items.every((w) => /^[A-Za-z]{5}\d{4}$/.test(w))

    if (allFiveWithSuffix && items.length >= 2000) {
      CACHED_SYMBOLS = items
      return CACHED_SYMBOLS
    }

    // 2) If the list is purely 5-letter words, expand them with a 4-digit suffix to reach >= 2500.
    if (allFive && items.length > 0) {
      const expanded = []
      const target = Math.max(2000, 2500)
      for (let i = 1; i <= target; i++) {
        const word = items[(i - 1) % items.length]
        expanded.push(`${word}${String(i).padStart(4, '0')}`)
      }
      CACHED_SYMBOLS = expanded
      return CACHED_SYMBOLS
    }

    // 3) Otherwise (mixed lengths or not strictly 5-letter words), use the list as-is.
    if (items.length > 0) {
      CACHED_SYMBOLS = items
      return CACHED_SYMBOLS
    }
  } catch {
    // removed unused catch variable
    // fall through to fallback
  }
  // Fallback: generate deterministic synthetic symbols (guarantee >= 2000)
  const fallback = []
  for (let i = 1; i <= 2500; i++) fallback.push(`SYM${String(i).padStart(4, '0')}`)
  CACHED_SYMBOLS = fallback
  return CACHED_SYMBOLS
}

/**
 * Generate a deterministic ScannerApiResponse-like payload for GET /scanner.
 *
 * Algorithm highlights
 * - Seeding: mix a stable baseSeed (from env/.seed) with a hash of normalized
 *   request params (including page) to produce a page-/filter-specific stream.
 * - Cohesive fields: values are cross-correlated (e.g., price affects fdv), yet
 *   randomized to look realistic. Some mcap fields are intentionally zeroed to
 *   exercise consumer fallback logic.
 * - Social links: derived from a long epoch window so links rarely change,
 *   improving snapshot stability while remaining seed-driven.
 * - Deduplication: ensure unique pairAddress rows to mimic backend guarantees.
 *
 * Parameters support
 * - page: number (1-based)
 * - chain: 'ETH' | 'BSC' | 'BASE' | 'SOL'
 * - sort/dir: applied by the dev middleware, not by this generator directly.
 *
 * @param {Record<string, any>} params
 * @returns {{ page: number, totalPages: number, scannerPairs: any[] }}
 */
export function generateScannerResponse(params = {}, tick = 0) {
  const page = Number(params.page ?? 1) || 1
  const totalPages = 10
  const size = 50
  const baseSeed = getBaseSeed()
  const paramSeed = hashParams({ ...params, page })
  const seed = mixSeeds(baseSeed, paramSeed)
  const rnd = mulberry32(seed)

  // Chain handling:
  // - If params.chain is provided, we honor it (legacy behavior) so callers can request
  //   a specific chain’s dataset.
  // - If not provided, we deterministically assign a chain per row using a secondary
  //   RNG derived from the seed and the symbol index to achieve a stable dispersion:
  //   ETH 55%, SOL 20%, BASE 15%, BSC 10%.
  const requestedChain =
    typeof params.chain === 'string' ? String(params.chain).toUpperCase() : undefined
  const routerMap = {
    ETH: ['0xRT_UNI', '0xRT_SUSHI'],
    BSC: ['0xRT_PCS', '0xRT_APE'],
    BASE: ['0xRT_BASE'],
    SOL: ['Raydium', 'Orca'],
  }

  const items = []
  const now = Date.now()

  // Secondary RNG seed for per-row chain assignment that does not perturb the main rnd()
  const chainSalt = 0x43484149 // 'CHAI'
  function pickChainByIndex(symbolIndex) {
    // Derive a per-index seed mixed with the main seed to keep stability across pages/filters
    const s = mixSeeds(seed, (chainSalt ^ (symbolIndex >>> 0)) >>> 0)
    const r = mulberry32(s)()
    // Weighted mapping: ETH 55%, SOL 20%, BASE 15%, BSC 10%
    if (r < 0.55) return 'ETH'
    if (r < 0.55 + 0.2) return 'SOL'
    if (r < 0.55 + 0.2 + 0.15) return 'BASE'
    return 'BSC'
  }

  // Prepare a deterministic shuffled order of symbols and a per-page offset so that:
  // - Selection appears random yet is reproducible for the same params/seed
  // - Symbols are not repeated until the full list has been traversed; then it resets
  const SYMBOLS = loadSymbols()
  const shuffleSeed = mixSeeds(seed, 0x53484f46) // arbitrary salt ('SHOF') for symbol order
  const rndSym = mulberry32(shuffleSeed)
  const indices = Array.from({ length: SYMBOLS.length }, (_, i) => i)
  for (let j = indices.length - 1; j > 0; j--) {
    const k = Math.floor(rndSym() * (j + 1))
    const tmp = indices[j]
    indices[j] = indices[k]
    indices[k] = tmp
  }
  const offset = ((page - 1) * size) % indices.length

  for (let i = 0; i < size; i++) {
    const createdAgoMs = Math.floor(rnd() * 7 * 24 * 3600 * 1000) // up to 7 days
    const ageIso = new Date(now - createdAgoMs).toISOString()

    const price = +(0.0001 + rnd() * 10).toFixed(6)
    const volume = +(rnd() * 1_000_000).toFixed(2)
    const liq = +(rnd() * 500_000).toFixed(2)

    const m1 = +(rnd() * 2_000_000).toFixed(2)
    const m2 = +(rnd() * 1_000_000).toFixed(2)
    const m3 = +(rnd() * 500_000).toFixed(2)
    const m4 = +(rnd() * 250_000).toFixed(2)

    const token1Decimals = 6 + Math.floor(rnd() * 12) // 6..17
    const token0Decimals = 18
    const token1Supply = Math.floor(1_000_000 + rnd() * 1_000_000_000)

    const symbolIndex = indices[(offset + i) % indices.length]
    const token1Symbol = SYMBOLS[symbolIndex]

    // Decide chain: honor explicit request if present, otherwise pick by index with weighted dispersion
    const chosenChain =
      requestedChain && routerMap[requestedChain] ? requestedChain : pickChainByIndex(symbolIndex)
    const chainId = chainNameToId(chosenChain)
    const token1Name = `${token1Symbol}-${chosenChain}`

    // Maintain rnd() consumption parity with previous implementation to keep
    // downstream deterministic streams (tests depend on it)
    void rnd()

    const pairAddress = mkAddress('PAIR', rnd)
    const token1Address = mkAddress('TKN', rnd)

    // Use tick and symbolIndex to vary buys/sells deterministically
    // Ensure buys/sells are monotonic with respect to `tick` by deriving a
    // stable per-item base and a deterministic per-tick growth rate.
    // For TEST_FAST=1 increase growth so tests see updates frequently.
    const FAST_TIMING = process && process.env && process.env.TEST_FAST === '1'
    // Derive two separate per-item seeds so buys and sells are uncorrelated.
    const perSeedA = mixSeeds(seed, (symbolIndex + 0x9e3779b9) >>> 0)
    const perSeedB = mixSeeds(seed, (symbolIndex ^ 0xabcdef01) >>> 0)
    const prA = mulberry32(perSeedA)
    const prB = mulberry32(perSeedB)

    // Base counts (stable per item)
    const baseBuys = Math.floor(prA() * 300) + Math.floor(prA() * 50) // 0..349
    const baseSells = Math.floor(prB() * 300) + Math.floor(prB() * 50) // 0..349

    // Growth rates per tick (ensure >=1). Make rates larger under FAST_TIMING.
    const rateBuys = (FAST_TIMING ? 3 : 1) + Math.floor(prA() * (FAST_TIMING ? 6 : 3)) // FAST: 3..8, else 1..3
    const rateSells = (FAST_TIMING ? 3 : 1) + Math.floor(prB() * (FAST_TIMING ? 6 : 3)) // FAST: 3..8, else 1..3

    // Additional monotonic per-tick fractional growth (scaled by a deterministic factor)
    // This produces more variance per tick while preserving monotonicity.
    const extraRateBuys = (FAST_TIMING ? 0.8 : 0.15) * (prA() * 2 + 0.2)
    const extraRateSells = (FAST_TIMING ? 0.8 : 0.15) * (prB() * 2 + 0.2)

    // Small deterministic noise independent of tick
    const noiseBuys = Math.floor(prA() * 5) // 0..4
    const noiseSells = Math.floor(prB() * 5) // 0..4

    const t = Math.floor(Number(tick) || 0)
    const buys = baseBuys + t * rateBuys + Math.floor(t * extraRateBuys) + noiseBuys
    const sells = baseSells + t * rateSells + Math.floor(t * extraRateSells) + noiseSells
    const txns = buys + sells

    const item = {
      age: ageIso,
      bundlerHoldings: toFixedStr(rnd() * 1000),
      buyFee: null,
      buys,
      chainId,
      contractRenounced: rnd() > 0.9,
      contractVerified: rnd() > 0.5,
      callCount: i + 1,
      currentMcap: String(m1),
      devHoldings: toFixedStr(rnd() * 1000),
      dexPaid: rnd() > 0.8,
      diff1H: toFixedStr((rnd() * 20 - 10).toFixed(2)),
      diff24H: toFixedStr((rnd() * 40 - 20).toFixed(2)),
      diff5M: toFixedStr((rnd() * 4 - 2).toFixed(2)),
      diff6H: toFixedStr((rnd() * 12 - 6).toFixed(2)),
      discordLink: null,
      fdv: toFixedStr(price * token1Supply),
      first1H: toFixedStr(price * 0.9),
      first24H: toFixedStr(price * 0.8),
      first5M: toFixedStr(price * 0.95),
      first6H: toFixedStr(price * 0.92),
      honeyPot: rnd() > 0.95,
      initialMcap: String(m2),
      insiderHoldings: toFixedStr(rnd() * 1000),
      insiders: Math.floor(rnd() * 100),
      isFreezeAuthDisabled: rnd() > 0.5,
      isMintAuthDisabled: rnd() > 0.5,
      liquidity: String(liq),
      liquidityLocked: rnd() > 0.7,
      liquidityLockedAmount: toFixedStr(rnd() * liq),
      liquidityLockedRatio: toFixedStr(rnd()),
      makers: null,
      migratedFromVirtualRouter: null,
      virtualRouterType: null,
      migratedFromPairAddress: null,
      migratedFromRouterAddress: null,
      migrationProgress: null,
      pairAddress,
      pairMcapUsd: String(m3),
      pairMcapUsdInitial: String(m4),
      percentChangeInLiquidity: toFixedStr((rnd() * 40 - 20).toFixed(2)),
      percentChangeInMcap: toFixedStr((rnd() * 40 - 20).toFixed(2)),
      price: String(price),
      reserves0: toFixedStr(rnd() * 10_000),
      reserves0Usd: toFixedStr(rnd() * 10_000),
      reserves1: toFixedStr(rnd() * 10_000),
      reserves1Usd: toFixedStr(rnd() * 10_000),
      routerAddress: String(pick(routerMap[chosenChain] || routerMap.ETH, rnd)),
      sellFee: null,
      sells,
      sniperHoldings: toFixedStr(rnd() * 1000),
      snipers: Math.floor(rnd() * 200),
      telegramLink: null,
      token0Decimals: token0Decimals, // Ensure number
      token0Symbol: chosenChain === 'SOL' ? 'WSOL' : chosenChain === 'BSC' ? 'WBNB' : 'WETH',
      token1Address,
      token1Decimals: String(token1Decimals), // Ensure string
      token1ImageUri: null, // string/null/undefined
      token1Name,
      token1Symbol,
      token1TotalSupplyFormatted: String(token1Supply),
      top10Holdings: toFixedStr(rnd() * token1Supply),
      twitterLink: null,
      txns,
      volume: String(volume),
      webLink: null,
    }

    // Deterministic social links with ~80% chance per link, derived from seed + token + coarse epoch
    try {
      const epochMs = 90 * 24 * 3600 * 1000 // 90 days to make updates very infrequent
      const epoch = Math.floor(now / epochMs)
      const socialSeed = mixSeeds(
        seed,
        hashParams({ k: String(pairAddress) + '|' + String(token1Symbol) + '|' + String(epoch) }),
      )
      const rndSoc = mulberry32(socialSeed)
      const base = String(token1Symbol || 't').toLowerCase()
      const suffix = String(pairAddress || '')
        .slice(-4)
        .toLowerCase()
      const maybe = () => rndSoc() < 0.8
      const pickTld = () => (rndSoc() < 0.5 ? 'io' : 'xyz')
      const linkWebsite = maybe() ? `https://www.${base}-${suffix}.${pickTld()}` : null
      const linkTwitter = maybe() ? `https://twitter.com/${base}${suffix}` : null
      const linkTelegram = maybe() ? `https://t.me/${base}_${suffix}` : null
      const linkDiscord = maybe() ? `https://discord.gg/${base}${suffix}` : null
      // Attach both preferred link* fields and legacy *Link fields for consumers
      item.linkWebsite = linkWebsite
      item.linkTwitter = linkTwitter
      item.linkTelegram = linkTelegram
      item.linkDiscord = linkDiscord
      if (linkWebsite) item.webLink = linkWebsite
      if (linkTwitter) item.twitterLink = linkTwitter
      if (linkTelegram) item.telegramLink = linkTelegram
      if (linkDiscord) item.discordLink = linkDiscord
    } catch {
      /* no-op */
    }

    // zero-out some mcap fields to exercise priority order randomly
    const roll = rnd()
    if (roll < 0.25) item.currentMcap = '0'
    if (roll < 0.5) item.initialMcap = '0'
    if (roll < 0.75) item.pairMcapUsd = '0'
    // leave pairMcapUsdInitial as is to ensure at least one > 0 most of the time

    items.push(item)
  }

  // Deduplicate by pairAddress (case-insensitive) to avoid duplicate rows downstream
  const seen = new Set()
  const uniqueItems = []
  for (const it of items) {
    const k = typeof it.pairAddress === 'string' ? it.pairAddress.toLowerCase() : ''
    if (k && !seen.has(k)) {
      seen.add(k)
      uniqueItems.push(it)
    }
  }
  return { page, totalPages, scannerPairs: uniqueItems }
}

/**
 * Create a minimal Connect-style middleware that serves /scanner from the generator.
 *
 * Behavior
 * - Parses URLSearchParams, normalizes a few known params (page: number, isNotHP: boolean).
 * - Delegates data generation to generateScannerResponse.
 * - Optionally applies allow-listed sorting on the server side for convenience in dev.
 * - Responds with application/json.
 *
 * This is intended for local development and tests; not a production server.
 *
 * @returns {(req: any, res: any, next: Function) => Promise<void>} Connect middleware.
 */
export function createScannerMockMiddleware() {
  return async function scannerMiddleware(req, res, next) {
    if (!req.url) return next()
    const u = new URL(req.url, 'http://localhost')
    if (u.pathname !== '/scanner') return next()
    const params = Object.fromEntries(u.searchParams.entries())
    // coerce some known params to numbers/booleans
    const norm = { ...params }
    if (typeof norm.page !== 'undefined') norm.page = Number(norm.page)
    if (typeof norm.isNotHP !== 'undefined') norm.isNotHP = norm.isNotHP === 'true'
    const json = generateScannerResponse(norm)

    // Apply server-side sorting (allow-listed) for dev middleware as well
    try {
      const sortAllow = new Set([
        'tokenName',
        'exchange',
        'price',
        'priceUsd',
        'mcap',
        'volume',
        'volumeUsd',
        'age',
        'tx',
        'liquidity',
      ])
      const dirAllow = new Set(['asc', 'desc'])
      const sortParam = typeof norm.sort === 'string' ? norm.sort : undefined
      const dirParam = typeof norm.dir === 'string' ? String(norm.dir).toLowerCase() : undefined
      const sortKey = sortParam && sortAllow.has(sortParam) ? sortParam : undefined
      const sortDir = dirParam && dirAllow.has(dirParam) ? dirParam : 'desc'
      if (sortKey) {
        const items = Array.isArray(json.scannerPairs) ? json.scannerPairs.slice() : []
        const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0')) || 0)
        const getMcap = (it) => {
          const cands = [it.currentMcap, it.initialMcap, it.pairMcapUsd, it.pairMcapUsdInitial]
          for (const c of cands) {
            const n = toNum(c)
            if (n > 0) return n
          }
          return 0
        }
        const getVal = (it) => {
          switch (sortKey) {
            case 'tokenName':
              return String(it.token1Name || '')
            case 'exchange':
              return String(
                it.routerAddress || it.virtualRouterType || it.migratedFromVirtualRouter || '',
              )
            case 'price':
            case 'priceUsd':
              return toNum(it.price)
            case 'mcap':
              return getMcap(it)
            case 'volume':
            case 'volumeUsd':
              return toNum(it.volume)
            case 'age':
              return new Date(it.age).getTime() || 0
            case 'tx':
              return toNum(it.txns)
            case 'liquidity':
              return toNum(it.liquidity)
            default:
              return 0
          }
        }
        items.sort((a, b) => {
          const va = getVal(a)
          const vb = getVal(b)
          let cmp
          if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb)
          else cmp = va < vb ? -1 : va > vb ? 1 : 0
          return sortDir === 'asc' ? cmp : -cmp
        })
        json.scannerPairs = items
      }
    } catch {
      /* ignore sort errors in dev */
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(json))
  }
}

/**
 * Create a Vite plugin that registers the mock /scanner middleware in dev.
 * Activation is gated by env: LOCAL_SCANNER=1 or VITE_USE_LOCAL_SCANNER=1.
 * @returns {{ name: string, apply: 'serve', configureServer(server: any): void }}
 */
export function createScannerMockPlugin() {
  return {
    name: 'local-mock-scanner-endpoint',
    apply: 'serve',

    configureServer(server) {
      const enabled =
        process.env.LOCAL_SCANNER === '1' || process.env.VITE_USE_LOCAL_SCANNER === '1'
      if (!enabled) return
      const mw = createScannerMockMiddleware()
      server.middlewares.use(mw)
    },
  }
}
