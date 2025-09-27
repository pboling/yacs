// subscription.queue.ts
// Rolling subscription manager for inactive tokens.
// Operates on keys in the `pair|token|chain` format.
// Maintains a FIFO queue of inactive-subscribed tokens and rotates on tick.
// Quotas:
// - Default (no throttle set): dynamic heuristic using a configurable base limit
//   base = getDefaultInactiveBaseLimit() (defaults to 0). If totalInactive <= base → subscribe all inactive,
//   else → subscribe base + ceil(1/10 of the remaining inactive).
// - When a throttle is set (max total subscriptions), inactive quota becomes:
//   min(inactiveUniverse.length, max(0, throttleMax - visible.size))
//
// Scrolling/visibility policy:
// - When a key becomes visible, it is subscribed by the pane and removed from the inactive queue.
// - When a key leaves the viewport, it remains subscribed and is appended to the tail of the
//   inactive FIFO queue. If the queue exceeds its quota, we unsubscribe from the head until
//   the queue fits. This guarantees: visible → active window; just-hidden → tail; rotation → head.

import { sendSubscribe, sendUnsubscribe } from './ws.mapper.js'
import { getDefaultInactiveBaseLimit } from './subscription.limit.bus.js'

type Key = string // pair|token|chain

const visible = new Set<Key>()
const ignored = new Set<Key>()
let universe: Key[] = [] // all keys known to the pane (deduped)

// Global throttle: maximum total subscriptions (visible + inactive). 0 or undefined → use default policy
let throttleMax: number | undefined = undefined

// FIFO queue of currently subscribed inactive keys
const inactiveQueue: Key[] = []
const inactiveSet = new Set<Key>() // mirror of queue for O(1) lookup

// Aging: last time key was unsubscribed
const lastUnsubscribedAt = new Map<Key, number>()

function splitKey(key: Key) {
  const [pair, token, chain] = key.split('|')
  return { pair, token, chain }
}

function getInactiveUniverse(): Key[] {
  // inactive = universe - visible - ignored
  const res: Key[] = []
  const seen = new Set<Key>()
  for (const k of universe) {
    if (seen.has(k)) continue
    seen.add(k)
    if (visible.has(k)) continue
    if (ignored.has(k)) continue
    res.push(k)
  }
  return res
}

function computeQuota(totalInactive: number) {
  if (totalInactive <= 0) return 0
  // If throttle is set and > 0, compute inactive quota as (throttle - visibleCount)
  if (typeof throttleMax === 'number' && throttleMax >= 0) {
    const allowedInactive = Math.max(0, throttleMax - visible.size)
    return Math.min(totalInactive, allowedInactive)
  }
  // Default heuristic quota using a dynamic base limit from global state
  const base = Math.max(0, getDefaultInactiveBaseLimit())
  if (totalInactive <= base) return totalInactive
  const remaining = totalInactive - base
  const extra = Math.ceil(remaining / 10)
  return base + extra
}

function pickOldestByUnsubscribed(keys: Key[], n: number): Key[] {
  if (n <= 0) return []
  // sort by lastUnsubscribedAt ascending (oldest first). Missing treated as 0.
  const copy = [...keys]
  copy.sort((a, b) => (lastUnsubscribedAt.get(a) ?? 0) - (lastUnsubscribedAt.get(b) ?? 0))
  return copy.slice(0, n)
}

function unsubscribeKey(ws: WebSocket | null, key: Key) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      lastUnsubscribedAt.set(key, Date.now())
      const { pair, token, chain } = splitKey(key)
      sendUnsubscribe(ws, { pair, token, chain })
    } catch {}
  }
}

function subscribeKey(ws: WebSocket | null, key: Key) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      const { pair, token, chain } = splitKey(key)
      sendSubscribe(ws, { pair, token, chain })
    } catch {}
  }
}

function removeFromQueue(key: Key) {
  if (!inactiveSet.has(key)) return
  inactiveSet.delete(key)
  const idx = inactiveQueue.indexOf(key)
  if (idx >= 0) inactiveQueue.splice(idx, 1)
}

function ensureQueueWithinQuota(ws: WebSocket | null) {
  const inactive = getInactiveUniverse()
  const inactiveSetUniverse = new Set(inactive)
  const quota = computeQuota(inactive.length)

  // 1) Remove any keys from queue that are no longer eligible
  for (let i = 0; i < inactiveQueue.length; ) {
    const key = inactiveQueue[i]
    if (visible.has(key)) {
      // Visible keys are managed by the pane; keep them subscribed but not in inactive queue
      inactiveQueue.splice(i, 1)
      inactiveSet.delete(key)
      continue
    }
    if (!inactiveSetUniverse.has(key) || ignored.has(key)) {
      // No longer in universe or user-disabled → unsubscribe immediately
      inactiveQueue.splice(i, 1)
      inactiveSet.delete(key)
      unsubscribeKey(ws, key)
      continue
    }
    i++
  }

  // 2) If under quota, fill with oldest-by-lastUnsubscribed inactive candidates not already in queue
  if (inactiveQueue.length < quota) {
    const candidates = inactive.filter((k) => !inactiveSet.has(k))
    const toAdd = pickOldestByUnsubscribed(candidates, quota - inactiveQueue.length)
    for (const key of toAdd) {
      inactiveQueue.push(key)
      inactiveSet.add(key)
      // These are newly admitted inactive subs → we must send subscribe
      subscribeKey(ws, key)
    }
  }

  // 3) If over quota, unsubscribe from head until we fit
  while (inactiveQueue.length > quota) {
    const key = inactiveQueue.shift()
    if (key) {
      inactiveSet.delete(key)
      unsubscribeKey(ws, key)
    } else {
      break
    }
  }
}

// Tick: rotate FIFO — unsubscribe head and subscribe next oldest inactive candidate at tail
function tick(ws: WebSocket | null) {
  const inactive = getInactiveUniverse()
  if (inactive.length === 0) return
  const quota = computeQuota(inactive.length)
  if (quota <= 0) {
    // No capacity for inactive subs; purge any queued
    while (inactiveQueue.length > 0) {
      const k = inactiveQueue.shift()
      if (!k) break
      inactiveSet.delete(k)
      unsubscribeKey(ws, k)
    }
    return
  }
  // If currently under quota, grow by adding one without removing any
  if (inactiveQueue.length < quota) {
    const candidates = inactive.filter((k) => !inactiveSet.has(k))
    const toAdd = pickOldestByUnsubscribed(candidates, 1)[0]
    if (toAdd) {
      inactiveQueue.push(toAdd)
      inactiveSet.add(toAdd)
      subscribeKey(ws, toAdd)
    }
    return
  }
  // Otherwise rotate: remove one from head and add one candidate
  const toRemove = inactiveQueue.shift()
  if (toRemove) {
    inactiveSet.delete(toRemove)
    unsubscribeKey(ws, toRemove)
  }
  const candidates = inactive.filter((k) => !inactiveSet.has(k))
  const toAdd = pickOldestByUnsubscribed(candidates, 1)[0]
  if (toAdd) {
    inactiveQueue.push(toAdd)
    inactiveSet.add(toAdd)
    subscribeKey(ws, toAdd)
  }
}

export const SubscriptionQueue = {
  getSubscribedCount(): number {
    try {
      // Total subscribed = visible (pane-managed) + inactiveSet (queue-managed)
      return visible.size + inactiveSet.size
    } catch {
      return 0
    }
  },
  getVisibleCount() {
    return visible.size
  },
  getInvisCount() {
    return inactiveQueue.length
  },
  updateUniverse(keys: Key[], ws: WebSocket | null) {
    const next = Array.isArray(keys) ? [...new Set(keys)] : []
    // Unsubscribe any queued/visible keys that are no longer in the universe
    const nextSet = new Set(next)
    for (const key of [...inactiveQueue]) {
      if (!nextSet.has(key)) {
        removeFromQueue(key)
        unsubscribeKey(ws, key)
      }
    }
    for (const key of Array.from(visible)) {
      if (!nextSet.has(key)) {
        visible.delete(key)
        // Pane will typically handle unsubscribing visible keys when no longer visible.
        // As a safety, also unsubscribe here since it left the universe.
        unsubscribeKey(ws, key)
      }
    }
    for (const key of Array.from(ignored)) {
      if (!nextSet.has(key)) ignored.delete(key)
    }
    universe = next
    ensureQueueWithinQuota(ws)
  },
  setVisible(key: Key, isVisible: boolean, ws: WebSocket | null) {
    if (isVisible) {
      visible.add(key)
      // Ensure it is not tracked as inactive
      removeFromQueue(key)
      // No subscribe here; pane already sent subscribe for visible keys
    } else {
      visible.delete(key)
      // When leaving viewport, keep it subscribed and move to the tail if eligible
      if (!ignored.has(key) && universe.includes(key) && !inactiveSet.has(key)) {
        inactiveQueue.push(key)
        inactiveSet.add(key)
        // Do not send subscribe here; it should already be subscribed while visible
        // Enforce quota (may unsubscribe from head if we overflow)
        const inactive = getInactiveUniverse()
        const quota = computeQuota(inactive.length)
        while (inactiveQueue.length > quota) {
          const k = inactiveQueue.shift()
          if (!k) break
          inactiveSet.delete(k)
          unsubscribeKey(ws, k)
        }
      } else {
        // Still reconcile to handle removals and fills
        ensureQueueWithinQuota(ws)
      }
    }
  },
  setIgnored(key: Key, isIgnored: boolean, ws: WebSocket | null) {
    if (isIgnored) {
      ignored.add(key)
      // Remove from visible and inactive, unsubscribe if was subscribed by us
      visible.delete(key)
      if (inactiveSet.has(key)) {
        removeFromQueue(key)
        unsubscribeKey(ws, key)
      } else {
        // If not in queue, still proactively unsubscribe for safety
        unsubscribeKey(ws, key)
      }
    } else {
      ignored.delete(key)
      // Do not auto-subscribe on unignore; let normal flow handle it
      ensureQueueWithinQuota(ws)
    }
  },
  noteUnsubscribed(key: Key) {
    // Record an explicit unsubscribe timestamp for external unsubscribes
    try {
      lastUnsubscribedAt.set(key, Date.now())
    } catch {}
  },
  tick,
  setThrottle(max: number | undefined, ws: WebSocket | null) {
    try {
      if (typeof max === 'number' && isFinite(max) && max >= 0) {
        throttleMax = Math.floor(max)
      } else {
        throttleMax = undefined
      }
      ensureQueueWithinQuota(ws)
    } catch {
      // no-op
    }
  },
  // For testing/inspection
  __debug__: {
    getUniverse: () => [...universe],
    getInactiveQueue: () => [...inactiveQueue],
    getLastUnsubscribedAt: (k: Key) => lastUnsubscribedAt.get(k) ?? 0,
    reset() {
      universe = []
      visible.clear()
      ignored.clear()
      inactiveQueue.length = 0
      inactiveSet.clear()
      lastUnsubscribedAt.clear()
    },
  },
}
