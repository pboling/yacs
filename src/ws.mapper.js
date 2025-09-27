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

// Optional logger sink: in browser, a global hook can be provided by the UI console.
// In tests/Node, this is a no-op.
function __wsLog(kind, text) {
  try {
    const g = globalThis && globalThis.__WS_CONSOLE_LOG__
    if (typeof g === 'function') g(kind, text)
  } catch {}
}

// Feature-gated allow-lists
const OUT_ALLOWED_ROOMS = new Set([
  'scanner-filter',
  'unsubscribe-scanner-filter',
  'subscribe-pair',
  'unsubscribe-pair',
  'subscribe-pair-stats',
  'unsubscribe-pair-stats',
])
const IN_ALLOWED_EVENTS = new Set(['scanner-pairs', 'tick', 'pair-stats', 'wpeg-prices'])

export function isAllowedOutgoingEvent(event) {
  return OUT_ALLOWED_ROOMS.has(String(event))
}
export function isAllowedIncomingEvent(event) {
  return IN_ALLOWED_EVENTS.has(String(event))
}

// Normalize chain to the symbol expected by WS API (ETH, BSC, BASE, SOL)
function toChainName(input) {
  const v = input == null ? '' : String(input).trim()
  const up = v.toUpperCase()
  if (up === 'ETH' || up === 'BSC' || up === 'BASE' || up === 'SOL') return up
  switch (Number(v)) {
    case 1:
      return 'ETH'
    case 56:
      return 'BSC'
    case 8453:
      return 'BASE'
    case 900:
      return 'SOL'
    default:
      return up || 'ETH'
  }
}

export function buildScannerSubscription(params) {
  return { event: 'scanner-filter', data: { ...params } }
}
export function buildScannerUnsubscription(params) {
  return { event: 'unsubscribe-scanner-filter', data: { ...params } }
}

export function buildPairSubscription({ pair, token, chain }) {
  const c = toChainName(chain)
  return { event: 'subscribe-pair', data: { pair, token, chain: c } }
}
export function buildPairUnsubscription({ pair, token, chain }) {
  const c = toChainName(chain)
  return { event: 'unsubscribe-pair', data: { pair, token, chain: c } }
}

export function buildPairStatsSubscription({ pair, token, chain }) {
  const c = toChainName(chain)
  return { event: 'subscribe-pair-stats', data: { pair, token, chain: c } }
}
export function buildPairStatsUnsubscription({ pair, token, chain }) {
  const c = toChainName(chain)
  return { event: 'unsubscribe-pair-stats', data: { pair, token, chain: c } }
}

// Global experiment flag: disable all WebSocket unsubscriptions (no-op send)
export const UNSUBSCRIPTIONS_DISABLED = true

// Thin send helpers to emit paired messages for a given pair/token/chain
// Each function attempts both sends but isolates failures so one failing message
// does not prevent the other from being delivered.
export function sendSubscribe(ws, { pair, token, chain }) {
  const key = String(pair) + '|' + String(token) + '|' + String(chain)
  try {
    ws &&
      ws.readyState === 1 &&
      isAllowedOutgoingEvent('subscribe-pair') &&
      (ws.send(JSON.stringify(buildPairSubscription({ pair, token, chain }))),
      __wsLog('success', 'subscribe-pair sent ' + key))
  } catch (err) {
    try {
      console.error('[ws.sendSubscribe] subscribe-pair failed', err)
      __wsLog(
        'error',
        'subscribe-pair failed ' + key + ' — ' + String(err && err.message ? err.message : err),
      )
    } catch {}
  }
  try {
    ws &&
      ws.readyState === 1 &&
      isAllowedOutgoingEvent('subscribe-pair-stats') &&
      (ws.send(JSON.stringify(buildPairStatsSubscription({ pair, token, chain }))),
      __wsLog('success', 'subscribe-pair-stats sent ' + key))
  } catch (err) {
    try {
      console.error('[ws.sendSubscribe] subscribe-pair-stats failed', err)
      __wsLog(
        'error',
        'subscribe-pair-stats failed ' +
          key +
          ' — ' +
          String(err && err.message ? err.message : err),
      )
    } catch {}
  }
}
export function sendUnsubscribe(ws, { pair, token, chain }) {
  if (UNSUBSCRIPTIONS_DISABLED) {
    try {
      const key = String(pair) + '|' + String(token) + '|' + String(chain)
      __wsLog('info', '[disabled] unsubscribe suppressed ' + key)
    } catch {}
    return
  }
  const key = String(pair) + '|' + String(token) + '|' + String(chain)
  try {
    ws &&
      ws.readyState === 1 &&
      isAllowedOutgoingEvent('unsubscribe-pair') &&
      (ws.send(JSON.stringify(buildPairUnsubscription({ pair, token, chain }))),
      __wsLog('info', 'unsubscribe-pair sent ' + key))
  } catch (err) {
    try {
      console.error('[ws.sendUnsubscribe] unsubscribe-pair failed', err)
      __wsLog(
        'error',
        'unsubscribe-pair failed ' + key + ' — ' + String(err && err.message ? err.message : err),
      )
    } catch {}
  }
  try {
    ws &&
      ws.readyState === 1 &&
      isAllowedOutgoingEvent('unsubscribe-pair-stats') &&
      (ws.send(JSON.stringify(buildPairStatsUnsubscription({ pair, token, chain }))),
      __wsLog('info', 'unsubscribe-pair-stats sent ' + key))
  } catch (err) {
    try {
      console.error('[ws.sendUnsubscribe] unsubscribe-pair-stats failed', err)
      __wsLog(
        'error',
        'unsubscribe-pair-stats failed ' +
          key +
          ' — ' +
          String(err && err.message ? err.message : err),
      )
    } catch {}
  }
}

// Map incoming WS message to reducer action (plain object), or null if not handled
export function mapIncomingMessageToAction(msg) {
  if (!msg || typeof msg !== 'object') return null
  // Gate all incoming events except allow-list when feature flag is OFF
  if (!isAllowedIncomingEvent(msg.event)) return null
  switch (msg.event) {
    case 'scanner-pairs':
      // Conform to test-task-types: { data: { filter, results: { pairs: [...] } } }
      return {
        type: 'scanner/pairs',
        payload: {
          page: (msg.data && msg.data.filter && msg.data.filter.page) || 1,
          scannerPairs:
            msg.data && msg.data.results && Array.isArray(msg.data.results.pairs)
              ? msg.data.results.pairs
              : [],
        },
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
      const d = (msg && typeof msg === 'object' ? msg.data : null) || {}
      const prices =
        d && typeof d === 'object' && d.prices && typeof d.prices === 'object' ? d.prices : {}
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
