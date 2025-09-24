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
export function buildPairUnsubscription({ pair, token, chain }) {
  return { event: 'unsubscribe-pair', data: { pair, token, chain } }
}

export function buildPairStatsSubscription({ pair, token, chain }) {
  return { event: 'subscribe-pair-stats', data: { pair, token, chain } }
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
    case 'tick':
      return { type: 'pair/tick', payload: { pair: msg.data.pair, swaps: msg.data.swaps } }
    case 'pair-stats':
      return { type: 'pair/stats', payload: { data: msg.data } }
    default:
      return null
  }
}
