import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildScannerSubscription,
  buildScannerUnsubscription,
  buildPairSubscription,
  buildPairUnsubscription,
  buildPairStatsSubscription,
  buildPairStatsUnsubscription,
  mapIncomingMessageToAction,
} from '../src/ws.mapper.js'

const scannerParams = { chain: 'ETH', page: 1, rankBy: 'volume', orderBy: 'desc' }

test('subscription builders produce expected payloads', () => {
  assert.deepEqual(buildScannerSubscription(scannerParams), { event: 'scanner-filter', data: scannerParams })
  assert.deepEqual(buildScannerUnsubscription(scannerParams), { event: 'unsubscribe-scanner-filter', data: scannerParams })
  const pair = { pair: '0xPAIR', token: '0xTOKEN', chain: 'ETH' }
  assert.deepEqual(buildPairSubscription(pair), { event: 'subscribe-pair', data: pair })
  assert.deepEqual(buildPairUnsubscription(pair), { event: 'unsubscribe-pair', data: pair })
  assert.deepEqual(buildPairStatsSubscription(pair), { event: 'subscribe-pair-stats', data: pair })
  assert.deepEqual(buildPairStatsUnsubscription(pair), { event: 'unsubscribe-pair-stats', data: pair })
})

test('mapIncomingMessageToAction maps known events and ignores unknown', () => {
  const scannerMsg = { event: 'scanner-pairs', data: { page: 2, scannerPairs: [{ pairAddress: '0xPAIR' }] } }
  const a1 = mapIncomingMessageToAction(scannerMsg)
  assert.equal(a1.type, 'scanner/pairs')
  assert.equal(a1.payload.page, 2)
  const tickMsg = { event: 'tick', data: { pair: { pair: '0xPAIR', token: '0xTOKEN', chain: 'ETH' }, swaps: [] } }
  const a2 = mapIncomingMessageToAction(tickMsg)
  assert.equal(a2.type, 'pair/tick')
  const statsMsg = { event: 'pair-stats', data: { pair: { pairAddress: '0xPAIR' }, pairStats: {}, migrationProgress: '0', callCount: 1 } }
  const a3 = mapIncomingMessageToAction(statsMsg)
  assert.equal(a3.type, 'pair/stats')
  const wpegMsg = { event: 'wpeg-prices', data: { prices: { ETH: '4183.1100', SOL: '210.5' } } }
  const a4 = mapIncomingMessageToAction(wpegMsg)
  assert.equal(a4.type, 'wpeg/prices')
  assert.deepEqual(a4.payload.prices, { ETH: '4183.1100', SOL: '210.5' })
  const unknown = mapIncomingMessageToAction({ event: 'unknown', data: {} })
  assert.equal(unknown, null)
})
