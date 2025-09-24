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

export const initialState = {
  byId: {}, // id -> TokenData
  meta: {}, // id -> { totalSupply: number, token0Address?: string }
  pages: {}, // pageNumber -> string[] ids present on that page
  filters: { excludeHoneypots: false },
}

export function tokensReducer(state = initialState, action) {
  switch (action.type) {
    case 'scanner/pairs': {
      const { page, scannerPairs } = action.payload // scannerPairs: ScannerResult[]
      const next = { ...state, byId: { ...state.byId }, meta: { ...state.meta }, pages: { ...state.pages } }
      const ids = []
      for (const s of scannerPairs) {
        const tNew = mapScannerResultToToken(s)
        const id = tNew.id
        ids.push(id)
        // preserve live price/mcap if already updated in state
        const existing = next.byId[id]
        next.byId[id] = existing ? { ...tNew, priceUsd: existing.priceUsd, mcap: existing.mcap, volumeUsd: existing.volumeUsd, transactions: existing.transactions } : tNew
        // store meta needed for ticks
        const totalSupply = parseFloat(s.token1TotalSupplyFormatted || '0') || 0
        next.meta[id] = { ...(next.meta[id] || {}), totalSupply }
      }
      // set page ids
      next.pages[page] = ids
      // Note: we purposely avoid global removal here to allow tokens present on other pages
      // The cleanup strategy can be implemented later if needed.
      return next
    }
    case 'pair/tick': {
      const { pair, swaps } = action.payload
      // pair = { pair, token, chain }
      const id = pair.pair
      const token = state.byId[id]
      if (!token) return state
      const meta = state.meta[id] || {}
      const token0Address = swaps?.[0]?.token0Address || meta.token0Address || ''
      const ctx = { totalSupply: meta.totalSupply || 0, token0Address, token1Address: token.tokenAddress }
      const updated = applyTickToToken(token, Array.isArray(swaps) ? swaps : [], ctx)
      return {
        ...state,
        byId: { ...state.byId, [id]: updated },
        meta: { ...state.meta, [id]: { ...meta, token0Address } },
      }
    }
    case 'pair/stats': {
      const { data } = action.payload // PairStatsMsgData
      const id = data.pair.pairAddress
      const token = state.byId[id]
      if (!token) return state
      const audit = {
        ...token.audit,
        honeypot: !!data.pair.token1IsHoneypot,
        contractVerified: !!data.pair.isVerified,
        mintable: !data.pair.mintAuthorityRenounced,
        freezable: !data.pair.freezeAuthorityRenounced,
      }
      return { ...state, byId: { ...state.byId, [id]: { ...token, audit } } }
    }
    case 'filters/set': {
      return { ...state, filters: { ...state.filters, ...action.payload } }
    }
    default:
      return state
  }
}

// Action creators (optional convenience)
export const actions = {
  scannerPairs: (page, scannerPairs) => ({ type: 'scanner/pairs', payload: { page, scannerPairs } }),
  tick: (pair, swaps) => ({ type: 'pair/tick', payload: { pair, swaps } }),
  pairStats: (data) => ({ type: 'pair/stats', payload: { data } }),
  setFilters: (payload) => ({ type: 'filters/set', payload }),
}
