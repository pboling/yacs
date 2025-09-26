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
import { isTieredChannelEnabled } from './utils/featureFlags.mjs'

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

export function buildPairX5Subscription({ pair, token, chain }) {
  return { event: 'subscribe-pair-x5', data: { pair, token, chain } }
}
export function buildPairStatsX5Subscription({ pair, token, chain }) {
  return { event: 'subscribe-pair-stats-x5', data: { pair, token, chain } }
}

// Thin send helpers to emit paired messages for a given pair/token/chain
// Each function attempts both sends but isolates failures so one failing message
// does not prevent the other from being delivered.
export function sendSubscribe(ws, { pair, token, chain }) {
  try {
    ws &&
      ws.readyState === 1 &&
      ws.send(JSON.stringify(buildPairSubscription({ pair, token, chain })))
  } catch (err) {
    try {
      console.error('[ws.sendSubscribe] subscribe-pair failed', err)
    } catch {}
  }
  try {
    ws &&
      ws.readyState === 1 &&
      ws.send(JSON.stringify(buildPairStatsSubscription({ pair, token, chain })))
  } catch (err) {
    try {
      console.error('[ws.sendSubscribe] subscribe-pair-stats failed', err)
    } catch {}
  }
}

export function sendSubscribeSlow(ws, { pair, token, chain }) {
  // Gate slow channels behind feature flag (off by default)
  if (!isTieredChannelEnabled()) return
  try {
    ws &&
      ws.readyState === 1 &&
      ws.send(JSON.stringify(buildPairSlowSubscription({ pair, token, chain })))
  } catch (err) {
    try {
      console.error('[ws.sendSubscribeSlow] subscribe-pair-slow failed', err)
    } catch {}
  }
  try {
    ws &&
      ws.readyState === 1 &&
      ws.send(JSON.stringify(buildPairStatsSlowSubscription({ pair, token, chain })))
  } catch (err) {
    try {
      console.error('[ws.sendSubscribeSlow] subscribe-pair-stats-slow failed', err)
    } catch {}
  }
}

export function sendUnsubscribe(ws, { pair, token, chain }) {
  try {
    ws &&
      ws.readyState === 1 &&
      ws.send(JSON.stringify(buildPairUnsubscription({ pair, token, chain })))
  } catch (err) {
    try {
      console.error('[ws.sendUnsubscribe] unsubscribe-pair failed', err)
    } catch {}
  }
  try {
    ws &&
      ws.readyState === 1 &&
      ws.send(JSON.stringify(buildPairStatsUnsubscription({ pair, token, chain })))
  } catch (err) {
    try {
      console.error('[ws.sendUnsubscribe] unsubscribe-pair-stats failed', err)
    } catch {}
  }
}

// Map incoming WS message to reducer action (plain object), or null if not handled
export function mapIncomingMessageToAction(msg) {
  if (!msg || typeof msg !== 'object') return null
  switch (msg.event) {
    case 'scanner-pairs':
      // full dataset replacement for a page
      return {
        type: 'scanner/pairs',
        payload: { page: msg.data.page ?? 1, scannerPairs: msg.data.scannerPairs ?? [] },
      }
    case 'scanner-append':
      // incremental append of new items for a page — gated behind tiered-channel
      if (!isTieredChannelEnabled()) return null
      return {
        type: 'scanner/append',
        payload: { page: msg.data.page ?? 1, scannerPairs: msg.data.scannerPairs ?? [] },
      }
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
      // not supported by production endpoint — gate behind tiered-channel
      if (!isTieredChannelEnabled()) return null
      const prices = msg.data && typeof msg.data === 'object' ? msg.data.prices || {} : {}
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
