/*
  tokens.reducer.js
  Centralized, pure reducer that manages normalized token state for both tables.
  State shape:
  - byId: Record<string, TokenData> — canonical source for row rendering
  - meta: Record<string, { totalSupply: number, token0Address?: string }> — auxiliary data used by tick processing
  - pages: Record<number, string[]> — page-specific ordering (separates Trending/New via different page ids)
  - filters: minimal client-side flags

  Action types (plain objects to keep testability high):
  - 'scanner/pairs' — replace the dataset for a page; preserves live price/mcap if already present
  - 'pair/tick'    — apply real-time swaps to a token (price, mcap, volume, tx counters)
  - 'pair/stats'   — update audit/meta info from pair-stats events
  - 'filters/set'  — update local filter flags

  Action types clarification:
  - 'scanner/pairs': Most common action for ingesting scanner data. Payload: { page, scannerPairs }. Expects an array of raw scanner results (unmapped or minimally mapped). The reducer will map these to TokenData as needed. Used throughout the app for both initial loads and updates.
  - 'scanner/pairsTokens': Used when the tokens are already mapped to TokenData before dispatch. Payload: { page, tokens }. This bypasses per-item mapping in the reducer. Used in scenarios where mapping is done outside the reducer for performance or architectural reasons.
  Both actions update byId and pages. The main difference is whether mapping is done before or inside the reducer. Use scanner/pairs for raw API results, and scanner/pairsTokens for pre-mapped tokens.
*/
// Pure tokens reducer to manage scanner pages, ticks, and pair-stats
import { mapScannerResultToToken, applyTickToToken } from './tdd.runtime.js'

import { debugLog as __debugLog__ } from './utils/debug.mjs'

// History helpers for 1-hour rolling window
const ONE_HOUR_MS = 60 * 60 * 1000
const __emptyHistory__ = () => ({
  ts: [],
  price: [],
  mcap: [],
  volume: [],
  buys: [],
  sells: [],
  liquidity: [],
})

export const initialState = {
  byId: {}, // id -> TokenData
  meta: {}, // id -> { totalSupply: number, token0Address?: string }
  pages: {}, // pageNumber -> string[] ids present on that page
  filters: {
    excludeHoneypots: false,
    chains: ['ETH', 'SOL', 'BASE', 'BSC'],
    minVolume: 0,
    maxAgeHours: null,
    minMcap: 0,
    limit: 200,
    tokenQuery: '',
    includeStale: false,
    includeDegraded: false,
  },
  wpegPrices: {}, // chain -> number
  version: 0, // monotonically increasing change counter for UI subscriptions
}

const __REDUCER_SEEN__ = new WeakSet()

function mergeToken(existing, tNew, now) {
  if (!existing) return { ...tNew, history: __emptyHistory__(), scannerAt: now }
  return {
    ...tNew,
    priceUsd: existing.priceUsd,
    mcap: existing.mcap,
    volumeUsd: existing.volumeUsd,
    transactions: existing.transactions,
    history: existing.history || __emptyHistory__(),
    scannerAt: now,
    tickAt: existing.tickAt,
    pairStatsAt: existing.pairStatsAt,
  }
}

function processTokens({ tokens, state, page, mapFn }) {
  const nextById = { ...state.byId }
  const nextMeta = { ...state.meta }
  const ids = []
  let changed = false
  for (const tRaw of Array.isArray(tokens) ? tokens : []) {
    const tNew = mapFn ? mapFn(tRaw) : tRaw
    const id = tNew.id
    const idLower = String(id || '').toLowerCase()
    ids.push(id)
    const existing = nextById[id] || nextById[idLower]
    const now = Date.now()
    const merged = mergeToken(existing, tNew, now)
    if (JSON.stringify(merged) !== JSON.stringify(existing)) changed = true
    nextById[id] = merged
    nextById[idLower] = merged
    // meta handling
    if (tRaw.token1TotalSupplyFormatted !== undefined) {
      const totalSupply = parseFloat(tRaw.token1TotalSupplyFormatted || '0') || 0
      const newMeta = { ...(nextMeta[id] || nextMeta[idLower] || {}), totalSupply }
      nextMeta[id] = newMeta
      nextMeta[idLower] = newMeta
    } else {
      const existingMeta = nextMeta[id] || nextMeta[idLower] || {}
      nextMeta[id] = existingMeta
      nextMeta[idLower] = existingMeta
    }
  }
  const nextPages = { ...state.pages, [page]: ids }
  return { nextById, nextMeta, nextPages, changed }
}

export function tokensReducer(state = initialState, action) {
  console.log('tokensReducer executed', { type: action.type })
  const result = (() => {
    switch (action.type) {
      case 'scanner/pairsTokens': {
        const { page, tokens } = action.payload
        const { nextById, nextMeta, nextPages, changed } = processTokens({ tokens, state, page })
        if (!changed && JSON.stringify(nextPages) === JSON.stringify(state.pages)) {
          return state
        }
        return {
          ...state,
          byId: nextById,
          meta: nextMeta,
          pages: nextPages,
          version: (state.version || 0) + 1,
        }
      }
      case 'scanner/pairs': {
        const { page, scannerPairs } = action.payload
        const { nextById, nextMeta, nextPages, changed } = processTokens({
          tokens: scannerPairs,
          state,
          page,
        })
        if (!changed && JSON.stringify(nextPages) === JSON.stringify(state.pages)) {
          return state
        }
        return {
          ...state,
          byId: nextById,
          meta: nextMeta,
          pages: nextPages,
          version: (state.version || 0) + 1,
        }
      }
      case 'scanner/append': {
        const { page, scannerPairs } = action.payload
        const { nextById, nextMeta, nextPages, changed } = processTokens({
          tokens: scannerPairs,
          state,
          page,
          mapFn: mapScannerResultToToken,
        })
        if (!changed && JSON.stringify(nextPages) === JSON.stringify(state.pages)) {
          return state
        }
        return {
          ...state,
          byId: nextById,
          meta: nextMeta,
          pages: nextPages,
          version: (state.version || 0) + 1,
        }
      }
      case 'pair/tick': {
        const { pair, swaps } = action.payload
        // pair = { pair, token, chain }
        const idOrig = String(pair.pair || '')
        const id = idOrig.toLowerCase()
        const token = state.byId[id] || state.byId[idOrig]
        if (!token) {
          // Suppress noisy warnings in tests and production unless explicitly enabled.
          try {
            const dbg =
              (typeof process !== 'undefined' && process.env && process.env.DEX_DEBUG_REDUCER) ===
              '1'
            if (dbg) {
              // Only log when developer opts in via DEX_DEBUG_REDUCER=1
              console.warn('REDUCER: pair/tick ignored - token not found in state.byId', {
                idOrig,
                idLower: id,
                knownKeys: Object.keys(state.byId).length,
              })
            }
          } catch {}
          return state
        }
        const meta = state.meta[id] || state.meta[idOrig] || {}
        // Persist token0Address if present on any swap; this enables correct buy/sell classification
        const token0FromSwaps = Array.isArray(swaps)
          ? swaps.find((s) => s && s.token0Address)?.token0Address || ''
          : ''
        const token0Address = token0FromSwaps || meta.token0Address || ''
        // Determine effective totalSupply for mcap recomputation:
        // Prefer meta.totalSupply from initial scanner payload; if missing/zero, derive from prior snapshot mcap/price.
        let totalSupply = (typeof meta.totalSupply === 'number' ? meta.totalSupply : 0) || 0
        if (!(Number.isFinite(totalSupply) && totalSupply > 0)) {
          const prevPrice = Number(token.priceUsd) || 0
          const prevMcap = Number(token.mcap) || 0
          if (prevPrice > 0 && prevMcap > 0) totalSupply = prevMcap / prevPrice
        }
        const ctx = { totalSupply, token0Address, token1Address: token.tokenAddress }
        const updated = applyTickToToken(token, Array.isArray(swaps) ? swaps : [], ctx)

        // Append to 1-hour rolling history
        const now = Date.now()
        const cutoff = now - ONE_HOUR_MS
        const prevHist =
          token.history && typeof token.history === 'object' ? token.history : __emptyHistory__()
        // Copy arrays to avoid mutating existing references
        const hist = {
          ts: [...prevHist.ts, now],
          price: [...prevHist.price, updated.priceUsd],
          mcap: [...prevHist.mcap, updated.mcap],
          volume: [...prevHist.volume, updated.volumeUsd],
          buys: [...prevHist.buys, updated.transactions?.buys ?? 0],
          sells: [...prevHist.sells, updated.transactions?.sells ?? 0],
          liquidity: [...prevHist.liquidity, updated.liquidity?.current ?? 0],
        }
        // Evict entries older than cutoff keeping arrays aligned
        let startIdx = 0
        const len = hist.ts.length
        while (startIdx < len && hist.ts[startIdx] < cutoff) startIdx++
        if (startIdx > 0) {
          hist.ts = hist.ts.slice(startIdx)
          hist.price = hist.price.slice(startIdx)
          hist.mcap = hist.mcap.slice(startIdx)
          hist.volume = hist.volume.slice(startIdx)
          hist.buys = hist.buys.slice(startIdx)
          hist.sells = hist.sells.slice(startIdx)
          hist.liquidity = hist.liquidity.slice(startIdx)
        }

        const nextTok = {
          ...updated,
          history: hist,
          tickAt: now,
          scannerAt: token.scannerAt,
          pairStatsAt: token.pairStatsAt,
        }

        try {
          if (updated && typeof updated.priceUsd === 'number') {
            if (!__REDUCER_SEEN__.has(action)) {
              __REDUCER_SEEN__.add(action)
              __debugLog__('REDUCER: pair/tick applied', {
                id: idOrig,
                oldPrice: token.priceUsd,
                newPrice: updated.priceUsd,
                oldMcap: token.mcap,
                newMcap: updated.mcap,
                vol: updated.volumeUsd,
                histPoints: hist.ts.length,
              })
            }
          }
        } catch {
          /* no-op */
        }
        // After computing nextTok, compare with existing token
        if (JSON.stringify(nextTok) === JSON.stringify(token)) {
          return state
        }
        return {
          ...state,
          byId: { ...state.byId, [id]: nextTok, [idOrig]: nextTok },
          meta: {
            ...state.meta,
            [id]: { ...meta, token0Address },
            [idOrig]: { ...meta, token0Address },
          },
          version: (state.version || 0) + 1,
        }
      }
      case 'pair/stats': {
        const { data } = action.payload // PairStatsMsgData
        const idOrig = String(data.pair?.pairAddress || '')
        const id = idOrig.toLowerCase()
        const token = state.byId[id] || state.byId[idOrig]
        if (!token) return state
        const p = data.pair || {}
        const audit = {
          ...token.audit,
          // README mapping:
          // mintable := mintAuthorityRenounced (no inversion)
          // freezable := freezeAuthorityRenounced (no inversion)
          // honeypot := !token1IsHoneypot
          // contractVerified := isVerified
          mintable: !!p.mintAuthorityRenounced,
          freezable: !!p.freezeAuthorityRenounced,
          honeypot: !p.token1IsHoneypot,
          contractVerified: !!p.isVerified,
          // Additional optional audit flags when provided
          renounced: p.contractRenounced ?? token.audit?.renounced,
          locked: p.liquidityLocked ?? token.audit?.locked,
          burned: p.burned ?? token.audit?.burned,
          // Social links + paid flag
          linkDiscord: p.linkDiscord ?? token.audit?.linkDiscord,
          linkTelegram: p.linkTelegram ?? token.audit?.linkTelegram,
          linkTwitter: p.linkTwitter ?? token.audit?.linkTwitter,
          linkWebsite: p.linkWebsite ?? token.audit?.linkWebsite,
          dexPaid: p.dexPaid ?? token.audit?.dexPaid,
        }
        const migrationPc = Number(data.migrationProgress ?? token.migrationPc ?? 0) || 0
        const security = {
          ...(token.security || {}),
          renounced: p.contractRenounced ?? (token.security ? token.security.renounced : undefined),
          locked: p.liquidityLocked ?? (token.security ? token.security.locked : undefined),
          burned: p.burned ?? (token.security ? token.security.burned : undefined),
        }
        const nextTok = { ...token, audit, security, migrationPc, pairStatsAt: Date.now() }
        // After computing nextTok, compare with existing token
        if (JSON.stringify(nextTok) === JSON.stringify(token)) {
          return state
        }
        return {
          ...state,
          byId: { ...state.byId, [id]: nextTok, [idOrig]: nextTok },
          version: (state.version || 0) + 1,
        }
      }
      // case 'pair/patch': {
      //   const { data } = action.payload || {}
      //   if (!data || typeof data !== 'object') return state
      //   const idCandidate = data.pairAddress || data.id || ''
      //   const idOrig = String(idCandidate || '')
      //   const id = idOrig.toLowerCase()
      //   const existing = state.byId[id] || state.byId[idOrig]
      //   if (!existing) return state
      //   // Normalize certain fields if present
      //   const patch = { ...data }
      //   if (typeof patch.tokenCreatedTimestamp === 'string' || patch.tokenCreatedTimestamp instanceof Date) {
      //     try { patch.tokenCreatedTimestamp = new Date(patch.tokenCreatedTimestamp) } catch { delete patch.tokenCreatedTimestamp }
      //   }
      //   if (patch.priceChangePcs && typeof patch.priceChangePcs === 'object') {
      //     const pc = patch.priceChangePcs
      //     const norm = {
      //       '5m': Number(pc['5m'] ?? pc.m5 ?? existing.priceChangePcs['5m']) || 0,
      //       '1h': Number(pc['1h'] ?? pc.h1 ?? existing.priceChangePcs['1h']) || 0,
      //       '6h': Number(pc['6h'] ?? pc.h6 ?? existing.priceChangePcs['6h']) || 0,
      //       '24h': Number(pc['24h'] ?? pc.h24 ?? existing.priceChangePcs['24h']) || 0,
      //     }
      //     patch.priceChangePcs = norm
      //   }
      //   // Limit to known top-level fields to avoid accidental pollution
      //   const allowedKeys = new Set([
      //     'tokenName','tokenSymbol','chain','exchange','priceUsd','mcap','volumeUsd','priceChangePcs','tokenCreatedTimestamp','transactions','liquidity'
      //   ])
      //   const safePatch = {}
      //   for (const k of Object.keys(patch)) {
      //     if (allowedKeys.has(k)) safePatch[k] = patch[k]
      //   }
      //   const nextTok = { ...existing, ...safePatch }
      //   return { ...state, byId: { ...state.byId, [id]: nextTok, [idOrig]: nextTok } }
      // }
      case 'wpeg/prices': {
        const prices = action.payload?.prices || {}
        const normalized = {}
        for (const k of Object.keys(prices)) {
          const v = prices[k]
          const n = typeof v === 'number' ? v : parseFloat(v || '0')
          if (!Number.isNaN(n)) normalized[k] = n
        }
        return {
          ...state,
          wpegPrices: { ...state.wpegPrices, ...normalized },
          version: (state.version || 0) + 1,
        }
      }
      case 'filters/set': {
        return { ...state, filters: { ...state.filters, ...action.payload } }
      }
      default:
        return state
    }
  })()
  console.log('tokensReducer state after action:', result)
  return result
}

// Action creators (optional convenience)
export const actions = {
  scannerPairs: (page, scannerPairs) => ({
    type: 'scanner/pairs',
    payload: { page, scannerPairs },
  }),
  tick: (pair, swaps) => ({ type: 'pair/tick', payload: { pair, swaps } }),
  pairStats: (data) => ({ type: 'pair/stats', payload: { data } }),
  // pairPatch: (data) => ({ type: 'pair/patch', payload: { data } }),
  setFilters: (payload) => ({ type: 'filters/set', payload }),
}
