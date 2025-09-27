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

export function tokensReducer(state = initialState, action) {
  console.log('tokensReducer executed')
  const result = (() => {
    switch (action.type) {
      case 'scanner/pairsTokens': {
        // Ingest pre-mapped TokenData[] directly (bypass per-item mapping)
        const { page, tokens } = action.payload
        const next = {
          ...state,
          byId: { ...state.byId },
          meta: { ...state.meta },
          pages: { ...state.pages },
        }
        const ids = []
        for (const tNew of Array.isArray(tokens) ? tokens : []) {
          const id = tNew.id
          const idLower = String(id || '').toLowerCase()
          ids.push(id)
          const existing = next.byId[id] || next.byId[idLower]
          const now = Date.now()
          const merged = existing
            ? {
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
            : { ...tNew, history: __emptyHistory__(), scannerAt: now }
          next.byId[id] = merged
          next.byId[idLower] = merged
          // meta.totalSupply is optional in mapped token; keep existing if present
          const existingMeta = next.meta[id] || next.meta[idLower] || {}
          next.meta[id] = existingMeta
          next.meta[idLower] = existingMeta
        }
        next.pages[page] = ids
        try {
          console.info('REDUCER: pages updated', {
            page,
            idsLen: Array.isArray(ids) ? ids.length : 0,
            sample: Array.isArray(ids) ? ids.slice(0, 3) : [],
          })
        } catch {}
        return { ...next, version: (state.version || 0) + 1 }
      }
      case 'scanner/pairs': {
        // Ingest raw scannerPairs[] for a page
        const { page, scannerPairs } = action.payload
        console.log('[tokensReducer] scanner/pairs payload:', { page, scannerPairs })
        const next = {
          ...state,
          byId: { ...state.byId },
          pages: { ...state.pages },
        }
        // Map and store each token by id
        for (const token of scannerPairs) {
          if (token && token.id) {
            next.byId[token.id] = token
          }
        }
        // Store the order of ids for this page
        next.pages[page] = scannerPairs.map((token) => token.id).filter(Boolean)
        next.version = (state.version || 0) + 1
        // Debug log: print number of tokens and page IDs
        try {
          console.log('[tokensReducer] scanner/pairs result:', {
            page,
            byIdCount: Object.keys(next.byId).length,
            pageIds: next.pages[page],
          })
        } catch {}
        return next
      }
      case 'scanner/append': {
        const { page, scannerPairs } = action.payload
        const next = {
          ...state,
          byId: { ...state.byId },
          meta: { ...state.meta },
          pages: { ...state.pages },
        }
        const ids = Array.isArray(next.pages[page]) ? [...next.pages[page]] : []
        for (const s of scannerPairs) {
          const tNew = mapScannerResultToToken(s)
          const id = tNew.id
          const idLower = String(id || '').toLowerCase()
          // merge into byId preserving any live-updated fields if present
          const existing = next.byId[id] || next.byId[idLower]
          const now = Date.now()
          const merged = existing
            ? {
                ...tNew,
                priceUsd: existing.priceUsd,
                mcap: existing.mcap,
                volumeUsd: existing.volumeUsd,
                transactions: existing.transactions,
                history: existing.history || __emptyHistory__(),
                // Track per-source timestamps
                scannerAt: now,
                tickAt: existing.tickAt,
                pairStatsAt: existing.pairStatsAt,
              }
            : { ...tNew, history: __emptyHistory__(), scannerAt: now }
          next.byId[id] = merged
          next.byId[idLower] = merged
          const totalSupply = parseFloat(s.token1TotalSupplyFormatted || '0') || 0
          const newMeta = { ...(next.meta[id] || next.meta[idLower] || {}), totalSupply }
          next.meta[id] = newMeta
          next.meta[idLower] = newMeta
          if (!ids.includes(id)) ids.push(id)
        }
        next.pages[page] = ids
        return { ...next, version: (state.version || 0) + 1 }
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
              (typeof process !== 'undefined' && process.env && process.env.DEX_DEBUG_REDUCER) === '1'
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
        if (!__REDUCER_SEEN__.has(action)) {
          __REDUCER_SEEN__.add(action)
          try {
            __debugLog__('REDUCER: pair/stats applied', {
              id: idOrig,
              audit: { contractVerified: audit.contractVerified, honeypot: audit.honeypot },
              migrationPc,
            })
          } catch {}
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
