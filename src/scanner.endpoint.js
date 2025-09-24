// Mock /scanner endpoint generator and Vite middleware/plugin (ESM)
// Provides deterministic, param-influenced mock data for development and tests.

// Deterministic PRNG (mulberry32)
function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ t >>> 15, 1 | t)
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r)
    return ((r ^ r >>> 14) >>> 0) / 4294967296
  }
}

function hashParams(params = {}) {
  const json = JSON.stringify(params, Object.keys(params).sort())
  let h = 2166136261
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
  }
  return h >>> 0
}

function pick(arr, rnd) {
  return arr[Math.floor(rnd() * arr.length)]
}

function chainNameToId(name) {
  switch (name) {
    case 'ETH': return 1
    case 'BSC': return 56
    case 'BASE': return 8453
    case 'SOL': return 900
    default: return 1
  }
}

function toFixedStr(num) {
  return Number(num).toFixed(6)
}

function mkAddress(prefix, rnd) {
  const hex = '0123456789abcdef'
  let s = '0x'
  for (let i = 0; i < 38; i++) s += pick(hex, rnd)
  return s + prefix
}

import { getBaseSeed, mixSeeds } from './seed.util.js'

export function generateScannerResponse(params = {}) {
  const page = Number(params.page ?? 1) || 1
  const totalPages = 10
  const size = 50
  const baseSeed = getBaseSeed()
  const paramSeed = hashParams({ ...params, page })
  const seed = mixSeeds(baseSeed, paramSeed)
  const rnd = mulberry32(seed)

  const chain = params.chain ?? 'ETH'
  const chainId = chainNameToId(chain)
  const routerMap = {
    ETH: ['0xROUTER_UNI', '0xROUTER_SUSHI'],
    BSC: ['0xROUTER_PCS', '0xROUTER_APE'],
    BASE: ['0xROUTER_BASE'],
    SOL: ['Raydium', 'Orca'],
  }

  const items = []
  const now = Date.now()
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

    const token1Symbol = ['MTK', 'COIN', 'DOGE', 'CAT', 'BIRD', 'X'][Math.floor(rnd() * 6)]
    const token1Name = `${token1Symbol}-${chain}`

    const pairAddress = mkAddress('PAIR', rnd)
    const token1Address = mkAddress('TKN', rnd)

    const buys = Math.floor(rnd() * 500)
    const sells = Math.floor(rnd() * 500)
    const txns = buys + sells

    const item = {
      age: ageIso,
      bundlerHoldings: toFixedStr(rnd() * 1000),
      buyFee: null,
      buys,
      callCount: 1,
      chainId,
      contractRenounced: rnd() > 0.9,
      contractVerified: rnd() > 0.5,
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
      honeyPot: rnd() > 0.95 ? true : false,
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
      routerAddress: pick(routerMap[chain] || routerMap.ETH, rnd),
      sellFee: null,
      sells,
      sniperHoldings: toFixedStr(rnd() * 1000),
      snipers: Math.floor(rnd() * 200),
      telegramLink: null,
      token0Decimals,
      token0Symbol: chain === 'SOL' ? 'WSOL' : 'WETH',
      token1Address,
      token1Decimals: String(token1Decimals),
      token1ImageUri: null,
      token1Name,
      token1Symbol,
      token1TotalSupplyFormatted: String(token1Supply),
      top10Holdings: toFixedStr(rnd() * token1Supply),
      twitterLink: null,
      txns,
      volume: String(volume),
      webLink: null,
    }

    // zero-out some mcap fields to exercise priority order randomly
    const roll = rnd()
    if (roll < 0.25) item.currentMcap = '0'
    if (roll < 0.5) item.initialMcap = '0'
    if (roll < 0.75) item.pairMcapUsd = '0'
    // leave pairMcapUsdInitial as is to ensure at least one > 0 most of the time

    items.push(item)
  }

  return { page, totalPages, scannerPairs: items }
}

// Minimal Vite dev middleware to serve /scanner using the generator above
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
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(json))
  }
}

// Vite plugin to register the middleware when enabled
export function createScannerMockPlugin() {
  return {
    name: 'local-mock-scanner-endpoint',
    apply: 'serve',
    configureServer(server) {
      const enabled = process.env.LOCAL_SCANNER === '1' || process.env.VITE_USE_LOCAL_SCANNER === '1'
      if (!enabled) return
      const mw = createScannerMockMiddleware()
      server.middlewares.use(mw)
    },
  }
}
