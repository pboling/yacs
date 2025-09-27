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
  assert.deepEqual(buildScannerSubscription(scannerParams), {
    event: 'scanner-filter',
    data: scannerParams,
  })
  assert.deepEqual(buildScannerUnsubscription(scannerParams), {
    event: 'unsubscribe-scanner-filter',
    data: scannerParams,
  })
  const pair = { pair: '0xPAIR', token: '0xTOKEN', chain: 'ETH' }
  assert.deepEqual(buildPairSubscription(pair), { event: 'subscribe-pair', data: pair })
  assert.deepEqual(buildPairUnsubscription(pair), { event: 'unsubscribe-pair', data: pair })
  assert.deepEqual(buildPairStatsSubscription(pair), { event: 'subscribe-pair-stats', data: pair })
  assert.deepEqual(buildPairStatsUnsubscription(pair), {
    event: 'unsubscribe-pair-stats',
    data: pair,
  })
})

test('mapIncomingMessageToAction maps known events and ignores unknown', () => {
  const scannerMsg = {
    event: 'scanner-pairs',
    data: {
      filter: { ...scannerParams, page: 2 },
      results: { pairs: [{ pairAddress: '0xPAIR' }] },
    },
  }
  const a1 = mapIncomingMessageToAction(scannerMsg)
  assert.equal(a1.type, 'scanner/pairs')
  assert.equal(a1.payload.page, 2)
  const tickMsg = {
    event: 'tick',
    data: { pair: { pair: '0xPAIR', token: '0xTOKEN', chain: 'ETH' }, swaps: [] },
  }
  const a2 = mapIncomingMessageToAction(tickMsg)
  assert.equal(a2.type, 'pair/tick')
  const statsMsg = {
    event: 'pair-stats',
    data: { pair: { pairAddress: '0xPAIR' }, pairStats: {}, migrationProgress: '0', callCount: 1 },
  }
  const a3 = mapIncomingMessageToAction(statsMsg)
  assert.equal(a3.type, 'pair/stats')
  const unknown = mapIncomingMessageToAction({ event: 'unknown', data: {} })
  assert.equal(unknown, null)
})
