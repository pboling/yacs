import test from 'node:test'
import assert from 'node:assert/strict'
import {
  __resetForTests,
  updatePaneVisibleCount,
  updatePaneRenderedCount,
  registerFastSubscription,
  registerSlowSubscription,
  engageSubscriptionLock,
  releaseSubscriptionLock,
  onSubscriptionEvictions,
  getSubscriptionMetrics,
} from '../src/subscription.lock.bus.js'

function collectEvictions(run) {
  const evicted = { fast: [], slow: [] }
  const off = onSubscriptionEvictions(({ fast, slow }) => {
    if (fast.length) evicted.fast.push(...fast)
    if (slow.length) evicted.slow.push(...slow)
  })
  try {
    run(evicted)
  } finally {
    off()
  }
  return evicted
}

test('eviction ordering for fast subscriptions respects oldest first', () => {
  __resetForTests()
  // Visible counts across two panes: 5 + 5 => sumVisible = 10 => normal fast limit = 16
  updatePaneVisibleCount('trending', 5)
  updatePaneVisibleCount('new', 5)
  // Register 20 fast subs; expect first 4 oldest evicted (k1..k4)
  const evicted = collectEvictions(() => {
    for (let i = 1; i <= 20; i++) {
      registerFastSubscription('k' + i)
    }
  })
  assert.deepEqual(evicted.slow, [], 'no slow evictions expected')
  assert.deepEqual(evicted.fast, ['k1', 'k2', 'k3', 'k4'])
  const metrics = getSubscriptionMetrics()
  assert.equal(metrics.counts.fast, metrics.limits.fast, 'fast count should equal fast limit')
  assert.equal(metrics.counts.fast, 16, 'fast limit should be 16 (10 visible + 6 buffer)')
})

test('eviction ordering for slow subscriptions respects oldest first', () => {
  __resetForTests()
  // No visible rows => normal fast limit = 6 (buffer) but we only test slow
  updatePaneRenderedCount('trending', 30)
  updatePaneRenderedCount('new', 30) // slow limit = 60
  const evicted = collectEvictions(() => {
    for (let i = 1; i <= 65; i++) {
      registerSlowSubscription('s' + i)
    }
  })
  // Oldest 5 slow subscriptions should be evicted: s1..s5
  assert.deepEqual(evicted.fast, [], 'no fast evictions expected')
  assert.deepEqual(evicted.slow, ['s1', 's2', 's3', 's4', 's5'])
  const metrics = getSubscriptionMetrics()
  assert.equal(metrics.counts.slow, metrics.limits.slow)
  assert.equal(metrics.counts.slow, 60)
})

test('lock transition reduces fast set to allowed keys, preserving them and evicting others', () => {
  __resetForTests()
  updatePaneVisibleCount('trending', 50) // normal fast limit = 56
  // Pre-populate 10 fast keys
  for (let i = 1; i <= 10; i++) registerFastSubscription('k' + i)
  const evicted = collectEvictions(() => {
    engageSubscriptionLock(['k3', 'k7'])
  })
  const metrics = getSubscriptionMetrics()
  // Fast limit should now equal allowed size = 2
  assert.equal(metrics.limits.fast, 2)
  assert.equal(metrics.counts.fast, 2)
  // Evicted keys should be all except k3 and k7
  const expectedEvicted = ['k1', 'k2', 'k4', 'k5', 'k6', 'k8', 'k9', 'k10']
  assert.deepEqual(evicted.fast.sort(), expectedEvicted.sort())
  // Release lock and ensure limit re-expands (fast limit becomes normal=56)
  releaseSubscriptionLock()
  const metricsAfter = getSubscriptionMetrics()
  assert.equal(metricsAfter.limits.normal, 56)
  assert.equal(metricsAfter.limits.fast, 56)
  // Fast keys remain at 2 (we do not auto expand previously evicted keys)
  assert.equal(metricsAfter.counts.fast, 2)
})

test('engaging lock with single allowed key when no fast subs does not error', () => {
  __resetForTests()
  updatePaneVisibleCount('trending', 1)
  const evicted = collectEvictions(() => {
    engageSubscriptionLock(['solo'])
  })
  assert.deepEqual(evicted.fast, [], 'nothing to evict')
  const metrics = getSubscriptionMetrics()
  assert.equal(metrics.limits.fast, 1)
  assert.equal(metrics.counts.fast, 0, 'no fast subs were auto-created')
})
