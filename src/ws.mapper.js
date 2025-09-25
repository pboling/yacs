/*
  ws.mapper.js
  Pure helpers to build WebSocket subscription messages and map incoming events
  to reducer actions. This file stays framework-agnostic and side-effect free
  to keep it highly testable and portable.

  Outgoing events built here:
  - scanner-filter / unsubscribe-scanner-filter
  - subscribe-pair / unsubscribe-pair
  - subscribe-pair-stats / unsubscribe-pair-stats

  Incoming events handled by mapIncomingMessageToAction:
  - scanner-pairs → { type: 'scanner/pairs', payload: { page, scannerPairs }}
  - tick          → { type: 'pair/tick', payload: { pair, swaps }}
  - pair-stats    → { type: 'pair/stats', payload: { data }}
*/
// WebSocket subscription builders and incoming message mapper (pure)
// Aligns with test-task-types.ts message shapes, but implemented in JS for tests.
// This approach allows developers to leverage the benefits of static typing for reliable code.
// The flexibility of JavaScript allows creating mock objects and test data.

export function buildScannerSubscription(params) {
  return { event: 'scanner-filter', data: { ...params } }
}
export function buildScannerUnsubscription(params) {
  return { event: 'unsubscribe-scanner-filter', data: { ...params } }
}

export function buildPairSubscription({ pair, token, chain }) {
  return { event: 'subscribe-pair', data: { pair, token, chain } }
}
export function buildPairSlowSubscription({ pair, token, chain }) {
  return { event: 'subscribe-pair-slow', data: { pair, token, chain } }
}
export function buildPairUnsubscription({ pair, token, chain }) {
  return { event: 'unsubscribe-pair', data: { pair, token, chain } }
}

export function buildPairStatsSubscription({ pair, token, chain }) {
  return { event: 'subscribe-pair-stats', data: { pair, token, chain } }
}
export function buildPairStatsSlowSubscription({ pair, token, chain }) {
  return { event: 'subscribe-pair-stats-slow', data: { pair, token, chain } }
}
export function buildPairStatsUnsubscription({ pair, token, chain }) {
  return { event: 'unsubscribe-pair-stats', data: { pair, token, chain } }
}

// Map incoming WS message to reducer action (plain object), or null if not handled
export function mapIncomingMessageToAction(msg) {
  if (!msg || typeof msg !== 'object') return null
  switch (msg.event) {
    case 'scanner-pairs':
      // full dataset replacement for a page
      return { type: 'scanner/pairs', payload: { page: msg.data.page ?? 1, scannerPairs: msg.data.scannerPairs ?? [] } }
    case 'scanner-append':
      // incremental append of new items for a page
      return { type: 'scanner/append', payload: { page: msg.data.page ?? 1, scannerPairs: msg.data.scannerPairs ?? [] } }
    case 'tick': {
      // Canonical shape only: { data: { pair: { pair, token, chain }, swaps: [...] } }
      const d = msg.data || {}
      if (!d.pair || typeof d.pair !== 'object' || !Array.isArray(d.swaps)) {
        return null
      }
      return { type: 'pair/tick', payload: { pair: d.pair, swaps: d.swaps } }
    }
    case 'pair-stats':
      return { type: 'pair/stats', payload: { data: msg.data } }
    case 'wpeg-prices': {
      const prices = (msg.data && typeof msg.data === 'object') ? (msg.data.prices || {}) : {}
      return { type: 'wpeg/prices', payload: { prices } }
    }
    // case 'pair-patch': {
    //   // Generic per-pair partial update to merge arbitrary fields into an existing row
    //   return { type: 'pair/patch', payload: { data: msg.data } }
    // }
    default:
      return null
  }
}
