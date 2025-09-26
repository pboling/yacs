// subscription.queue.ts
// Rolling subscription manager for inactive tokens.
// Operates on keys in the `pair|token|chain` format.
// Maintains a FIFO queue of inactive-subscribed tokens and rotates on tick.
// Quotas:
// - if inactive loaded < 100 → subscribe all inactive
// - else → subscribe first 100 + ceil(1/10 of the remaining inactive)

import { sendSubscribe, sendUnsubscribe } from './ws.mapper.js'

type Key = string // pair|token|chain

const visible = new Set<Key>()
const ignored = new Set<Key>()
let universe: Key[] = [] // all keys known to the pane (deduped)

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
  if (totalInactive < 100) return totalInactive
  const remaining = totalInactive - 100
  const extra = Math.ceil(remaining / 10)
  return 100 + extra
}

function pickOldestByUnsubscribed(keys: Key[], n: number): Key[] {
  if (n <= 0) return []
  // sort by lastUnsubscribedAt ascending (oldest first). Missing treated as 0.
  const copy = [...keys]
  copy.sort((a, b) => (lastUnsubscribedAt.get(a) ?? 0) - (lastUnsubscribedAt.get(b) ?? 0))
  return copy.slice(0, n)
}

function ensureQueueWithinQuota(ws: WebSocket | null) {
  const inactive = getInactiveUniverse()
  const quota = computeQuota(inactive.length)

  // Determine desired set: first by quota selection policy
  let desired: Key[]
  if (inactive.length <= quota) desired = inactive
  else desired = pickOldestByUnsubscribed(inactive, quota)

  const desiredSet = new Set(desired)

  // Unsubscribe any keys currently in queue but not desired anymore
  for (let i = 0; i < inactiveQueue.length; ) {
    const key = inactiveQueue[i]
    if (!desiredSet.has(key) || visible.has(key) || ignored.has(key)) {
      // remove from queue
      inactiveQueue.splice(i, 1)
      inactiveSet.delete(key)
      // send unsubscribe
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          const when = Date.now()
          lastUnsubscribedAt.set(key, when)
          const { pair, token, chain } = splitKey(key)
          sendUnsubscribe(ws, { pair, token, chain })
        } catch {}
      }
      continue
    }
    i++
  }

  // Subscribe desired keys not in queue
  for (const key of desired) {
    if (inactiveSet.has(key)) continue
    if (visible.has(key) || ignored.has(key)) continue
    inactiveQueue.push(key)
    inactiveSet.add(key)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const { pair, token, chain } = splitKey(key)
        sendSubscribe(ws, { pair, token, chain })
      } catch {}
    }
  }
}

// Tick: remove oldest from queue and replace with the most aged inactive not in queue
function tick(ws: WebSocket | null) {
  const inactive = getInactiveUniverse()
  if (inactive.length === 0) return
  // candidates not in queue
  const candidates = inactive.filter((k) => !inactiveSet.has(k))
  if (candidates.length === 0) return
  const toAdd = pickOldestByUnsubscribed(candidates, 1)[0]
  // remove oldest from queue (FIFO)
  const toRemove = inactiveQueue.shift()
  if (toRemove) {
    inactiveSet.delete(toRemove)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        lastUnsubscribedAt.set(toRemove, Date.now())
        const { pair, token, chain } = splitKey(toRemove)
        sendUnsubscribe(ws, { pair, token, chain })
      } catch {}
    }
  }
  // add new key
  if (toAdd) {
    inactiveQueue.push(toAdd)
    inactiveSet.add(toAdd)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const { pair, token, chain } = splitKey(toAdd)
        sendSubscribe(ws, { pair, token, chain })
      } catch {}
    }
  }
}

export const SubscriptionQueue = {
  updateUniverse(keys: Key[], ws: WebSocket | null) {
    universe = Array.isArray(keys) ? [...new Set(keys)] : []
    ensureQueueWithinQuota(ws)
  },
  setVisible(key: Key, isVisible: boolean, ws: WebSocket | null) {
    if (isVisible) visible.add(key)
    else visible.delete(key)
    ensureQueueWithinQuota(ws)
  },
  setIgnored(key: Key, isIgnored: boolean, ws: WebSocket | null) {
    if (isIgnored) ignored.add(key)
    else ignored.delete(key)
    ensureQueueWithinQuota(ws)
  },
  noteUnsubscribed(key: Key) {
    // Record an explicit unsubscribe timestamp for external unsubscribes
    try {
      lastUnsubscribedAt.set(key, Date.now())
    } catch {}
  },
  tick,
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
