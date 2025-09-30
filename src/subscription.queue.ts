// subscription.queue.ts
// Rolling subscription manager for invisible tokens.
// Operates on keys in the `pair|token|chain` format.
// Maintains a FIFO queue of invisible-subscribed tokens and rotates on tick.
// Quotas:
// - Default (no throttle set): dynamic heuristic using a configurable base limit
//   base = getDefaultInvisibleBaseLimit() (defaults to 100). If totalInvisible <= base → subscribe all invisible,
//   else → subscribe base + ceil(1/10 of the remaining invisible).
// - When a throttle is set (max total subscriptions), invisible quota becomes:
//   min(invisibleUniverse.length, max(0, throttleMax - visible.size))
//
// Scrolling/visibility policy:
// - When a key becomes visible, it is subscribed by the pane and removed from the invisible queue.
// - When a key leaves the viewport, it remains subscribed and is appended to the tail of the
//   invisible FIFO queue. If the queue exceeds its quota, we unsubscribe from the head until
//   the queue fits. This guarantees: visible → active window; just-hidden → tail; rotation → head.

import { sendSubscribe, sendUnsubscribe, UNSUBSCRIPTIONS_DISABLED } from './ws.mapper.js'
import { getDefaultInvisibleBaseLimit } from './subscription.limit.bus.js'
import { debugLog } from './utils/debug.mjs'

type Key = string // pair|token|chain

// Runtime validator: ensure keys follow pair|token|chain
function isValidKey(key: Key): boolean {
  // Removed unnecessary typeof check; Key is always string
  const parts = key.split('|')
  if (parts.length !== 3) return false
  const [pair, token, chain] = parts
  return !!pair && !!token && !!chain
}

// Instrumented Set wrapper: monkey-patch mutators to guarantee logs on any change
function instrumentSet<T>(set: Set<T>, name: string) {
  try {
    type MutableSet<U> = Set<U> & {
      add: (value: U) => Set<U>
      delete: (value: U) => boolean
      clear: () => void
      __instrumented__?: boolean
    }
    const mutable = set as unknown as MutableSet<T>
    if (mutable.__instrumented__ === true) return set
    const origAdd = mutable.add.bind(mutable)
    const origDelete = mutable.delete.bind(mutable)
    const origClear = mutable.clear.bind(mutable)
    function logChange(action: string, key?: unknown) {
      try {
        const stack = new Error('set change trace').stack
        debugLog(`[SubscriptionQueue] ${name} changed`, {
          action,
          key,
          size: mutable.size,
          sample: Array.from(mutable).slice(0, 10),
          time: new Date().toISOString(),
          stack,
        })
      } catch {}
    }
    mutable.add = (value: T) => {
      const before = mutable.size
      const res = origAdd(value)
      if (mutable.size !== before) logChange('add', value)
      return res
    }
    mutable.delete = (value: T) => {
      const before = mutable.size
      const res = origDelete(value)
      if (mutable.size !== before) logChange('delete', value)
      return res
    }
    mutable.clear = () => {
      const had = mutable.size
      origClear()
      if (had > 0) logChange('clear')
    }
    mutable.__instrumented__ = true
    try {
      debugLog(`[SubscriptionQueue] Instrumented Set '${name}'`)
    } catch {}
  } catch {}
  return set
}

const visible = new Map<Key, Set<string>>() // key -> set of tableIds
const ignored = instrumentSet(new Set<Key>(), 'ignored')
let universe: Key[] = [] // all keys known to the pane (deduped)

// FIFO queue of currently subscribed invisible keys (ACTIVE invisible subscriptions)
// Important: InvisSubs shown in the UI is derived from invisibleQueue.length. This is the number
// of invisible keys we are actively subscribed to right now — not the total number of invisible
// candidates in the universe. Items rotate within this queue based on the quota.
// Quota heuristic (when no runtime throttle):
//   base = getDefaultInvisibleBaseLimit() (UI “Throttle” control)
//   if totalInvisible <= base → subscribe all invisible
//   else → subscribe base + ceil(10% of (totalInvisible - base))
// Example: with ~400 total rows and ~20 visible, totalInvisible≈380, base=100 ⇒
//   remaining=280, extra=ceil(28)=28 ⇒ InvisSubs≈128 (queue length). Seeing ~124–128 is expected.
const invisibleQueue: Key[] = []
const invisibleSet = instrumentSet(new Set<Key>(), 'invisibleSet') // mirror of queue for O(1) lookup

// Aging: last time key was unsubscribed
const lastUnsubscribedAt = new Map<Key, number>()

function splitKey(key: Key) {
  const [pair, token, chain] = key.split('|')
  return { pair, token, chain }
}

function getInvisibleUniverse(): Key[] {
  // invisible = universe - visible - ignored
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

function computeQuota(totalInvisible: number) {
  if (totalInvisible <= 0) return 0
  // Default heuristic quota using a dynamic base limit from global state
  const base = Math.max(0, getDefaultInvisibleBaseLimit())
  if (totalInvisible <= base) return totalInvisible
  const remaining = totalInvisible - base
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

function unsubscribeKey(
  ws: WebSocket | null,
  key: Key,
  reason: string,
  details?: Record<string, unknown>,
) {
  try {
    lastUnsubscribedAt.set(key, Date.now())
    const { pair, token, chain } = splitKey(key)
    try {
      const stack = new Error('unsubscribe trace').stack
      debugLog('[SubscriptionQueue] UNSUB', {
        key,
        reason,
        details,
        when: new Date().toISOString(),
        wsOpen: !!(ws && ws.readyState === WebSocket.OPEN),
        stack,
      })
    } catch {}
    // When global UNSUBSCRIPTIONS_DISABLED is on, skip the WS call entirely to avoid
    // emitting "[disabled] unsubscribe suppressed" messages into WsConsole.
    if (UNSUBSCRIPTIONS_DISABLED) return
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendUnsubscribe(ws, { pair, token, chain })
    }
  } catch {}
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
  if (!invisibleSet.has(key)) return
  invisibleSet.delete(key)
  const idx = invisibleQueue.indexOf(key)
  if (idx >= 0) invisibleQueue.splice(idx, 1)
}

function ensureQueueWithinQuota(ws: WebSocket | null) {
  const invisible = getInvisibleUniverse()
  const invisibleSetUniverse = new Set(invisible)
  const quota = computeQuota(invisible.length)

  // 1) Remove any keys from queue that are no longer eligible
  for (let i = 0; i < invisibleQueue.length; ) {
    const key = invisibleQueue[i]
    if (visible.has(key)) {
      // Visible keys are managed by the pane; keep them subscribed but not in inactive queue
      invisibleQueue.splice(i, 1)
      invisibleSet.delete(key)
      continue
    }
    if (!invisibleSetUniverse.has(key) || ignored.has(key)) {
      // No longer in universe or user-disabled → unsubscribe immediately
      invisibleQueue.splice(i, 1)
      invisibleSet.delete(key)
      const reason = !invisibleSetUniverse.has(key)
        ? 'not-in-invisible-universe (likely removed from universe or became visible/ignored)'
        : 'ignored=true'
      unsubscribeKey(ws, key, reason, { phase: 'ensureQueueWithinQuota/eligibility' })
      continue
    }
    i++
  }

  // 2) If under quota, fill with oldest-by-lastUnsubscribed inactive candidates not already in queue
  if (invisibleQueue.length < quota) {
    const candidates = invisible.filter((k) => !invisibleSet.has(k))
    const toAdd = pickOldestByUnsubscribed(candidates, quota - invisibleQueue.length)
    for (const key of toAdd) {
      invisibleQueue.push(key)
      invisibleSet.add(key)
      // These are newly admitted inactive subs → we must send subscribe
      subscribeKey(ws, key)
    }
  }

  // 3) If over quota, unsubscribe from head until we fit
  while (invisibleQueue.length > quota) {
    const key = invisibleQueue.shift()
    if (key) {
      invisibleSet.delete(key)
      unsubscribeKey(ws, key, 'over-invisible-quota', {
        phase: 'ensureQueueWithinQuota/shrink',
        quota,
        queueLen: invisibleQueue.length,
      })
    } else {
      break
    }
  }
}

// Tick: rotate FIFO — unsubscribe head and subscribe next oldest inactive candidate at tail
function tick(ws: WebSocket | null) {
  const invisible = getInvisibleUniverse()
  if (invisible.length === 0) return
  const quota = computeQuota(invisible.length)
  if (quota <= 0) {
    // No capacity for inactive subs; purge any queued
    while (invisibleQueue.length > 0) {
      const k = invisibleQueue.shift()
      if (!k) break
      invisibleSet.delete(k)
      unsubscribeKey(ws, k, 'no-invisible-quota (quota<=0)', { phase: 'tick/purge', quota })
    }
    return
  }
  // If currently under quota, grow by adding one without removing any
  if (invisibleQueue.length < quota) {
    const candidates = invisible.filter((k) => !invisibleSet.has(k))
    const toAdd = pickOldestByUnsubscribed(candidates, 1)[0]
    if (toAdd) {
      invisibleQueue.push(toAdd)
      invisibleSet.add(toAdd)
      subscribeKey(ws, toAdd)
    }
    return
  }
  // Otherwise rotate: remove one from head and add one candidate
  const toRemove = invisibleQueue.shift()
  if (toRemove) {
    invisibleSet.delete(toRemove)
    unsubscribeKey(ws, toRemove, 'rotation', { phase: 'tick/rotate' })
  }
  const candidates = invisible.filter((k) => !invisibleSet.has(k))
  const toAdd = pickOldestByUnsubscribed(candidates, 1)[0]
  if (toAdd) {
    invisibleQueue.push(toAdd)
    invisibleSet.add(toAdd)
    subscribeKey(ws, toAdd)
  }
}

const tableVisible = new Map<string, Set<Key>>() // per-table current visible keys

export const SubscriptionQueue = {
  // Removed unused getSubscribedCount
  getVisibleCount() {
    try {
      // Count keys with non-empty TableId sets
      let count = 0
      for (const ids of visible.values()) {
        if (ids.size > 0) count++
      }
      debugLog('[SubscriptionQueue] getVisibleCount:', count, Array.from(visible.entries()))
      return count
    } catch {
      return 0
    }
  },
  getInvisCount() {
    return invisibleQueue.length
  },
  getVisibleKeys(): string[] {
    try {
      const out: string[] = []
      for (const [key, ids] of visible.entries()) {
        if (ids && ids.size > 0) out.push(key)
      }
      return out
    } catch {
      return []
    }
  },
  updateUniverse(keys: Key[], ws: WebSocket | null) {
    const nextRaw = Array.isArray(keys) ? [...new Set(keys)] : []
    // Filter and warn on malformed keys
    const next: Key[] = []
    for (const k of nextRaw) {
      if (isValidKey(k)) next.push(k)
      else {
        try {
          console.warn('[SubscriptionQueue] updateUniverse: invalid key', k)
        } catch {}
      }
    }
    debugLog('[SubscriptionQueue] updateUniverse: incoming keys', next)
    // Unsubscribe any queued/visible keys that are no longer in the universe
    const nextSet = new Set(next)
    for (const entry of [...invisibleQueue]) {
      let key: string | undefined
      if (Array.isArray(entry)) {
        if (typeof entry[0] === 'string') key = entry[0]
      } else if (typeof entry === 'string') {
        key = entry
      }
      if (key && !nextSet.has(key)) {
        removeFromQueue(key)
        unsubscribeKey(ws, key, 'removed-from-universe', { phase: 'updateUniverse/remove' })
      }
    }
    // Suppress removal of visible keys from visible set
    for (const [key] of Array.from(visible)) {
      if (!nextSet.has(key)) {
        // console.log('[SubscriptionQueue] updateUniverse: would remove visible', key);
        // visible.delete(key)
        // unsubscribeKey(ws, key)
      }
    }
    for (const key of Array.from(ignored)) {
      if (!nextSet.has(key)) ignored.delete(key)
    }
    universe = next
    ensureQueueWithinQuota(ws)
  },
  setVisible(key: Key, isVisible: boolean, ws: WebSocket | null, tableId?: string) {
    if (!isValidKey(key)) {
      try {
        console.warn('[SubscriptionQueue] setVisible: invalid key', key, 'tableId:', tableId)
      } catch {}
      return
    }
    if (!tableId) {
      console.warn('[SubscriptionQueue] setVisible: missing tableId for key', key)
      return
    }
    let ids = visible.get(key)
    if (!ids) {
      ids = instrumentSet(new Set<string>(), `visible.ids:${key}`)
      visible.set(key, ids)
    }
    if (isVisible) {
      ids.add(tableId)
      removeFromQueue(key)
      // Debug log
      try {
        debugLog(
          '[SubscriptionQueue] setVisible: added',
          key,
          'tableId:',
          tableId,
          'ids:',
          Array.from(ids),
          'visible.size:',
          visible.size,
        )
      } catch {}
    } else {
      ids.delete(tableId)
      // Only remove key if no tables report it as visible
      if (ids.size === 0) {
        // No table keeps this key visible anymore → move it to invisible queue (still subscribed)
        visible.delete(key)
        // Append to tail if not already queued, then enforce quota. Do NOT unsubscribe here.
        if (!invisibleSet.has(key)) {
          invisibleQueue.push(key)
          invisibleSet.add(key)
        }
        try {
          debugLog(
            '[SubscriptionQueue] setVisible: moved to invisible queue',
            key,
            'tableId:',
            tableId,
            'visible.size:',
            visible.size,
            'invisible.queueLen:',
            invisibleQueue.length,
          )
        } catch {}
        // Ensure queue respects current quota and eligibility
        ensureQueueWithinQuota(ws)
      }
    }
  },
  setIgnored(key: Key, isIgnored: boolean, ws: WebSocket | null) {
    if (isIgnored) {
      ignored.add(key)
      // Remove from visible and inactive, unsubscribe if was subscribed by us
      visible.delete(key)
      if (invisibleSet.has(key)) {
        removeFromQueue(key)
        unsubscribeKey(ws, key, 'ignored=true (in-queue)', { phase: 'setIgnored/true' })
      } else {
        // If not in queue, still proactively unsubscribe for safety
        unsubscribeKey(ws, key, 'ignored=true (not-in-queue)', { phase: 'setIgnored/true' })
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
  setTableVisible(tableId: string, keys: Key[], ws: WebSocket | null) {
    if (!tableId) {
      try {
        console.warn('[SubscriptionQueue] setTableVisible: missing tableId')
      } catch {}
      return
    }
    // Normalize and dedupe keys, filter invalid
    const next: Key[] = []
    const seen = new Set<Key>()
    for (const k of Array.isArray(keys) ? keys : []) {
      if (!isValidKey(k)) continue
      if (seen.has(k)) continue
      seen.add(k)
      next.push(k)
    }
    const nextSet = new Set(next)
    const prevSet = tableVisible.get(tableId) ?? new Set<Key>()

    // Removed for this table
    for (const key of prevSet) {
      if (nextSet.has(key)) continue
      const ids = visible.get(key)
      if (!ids) {
        // nothing to do
      } else {
        ids.delete(tableId)
        if (ids.size === 0) {
          visible.delete(key)
          if (!ignored.has(key)) {
            if (!invisibleSet.has(key)) {
              invisibleQueue.push(key)
              invisibleSet.add(key)
            }
          }
        }
      }
    }

    // Added for this table
    for (const key of nextSet) {
      let ids = visible.get(key)
      if (!ids) {
        ids = instrumentSet(new Set<string>(), `visible.ids:${key}`)
        visible.set(key, ids)
      }
      if (!ids.has(tableId)) {
        ids.add(tableId)
      }
      // ensure not in invisible queue
      removeFromQueue(key)
    }

    tableVisible.set(tableId, nextSet)

    // Enforce quota changes once after batch
    ensureQueueWithinQuota(ws)

    try {
      debugLog('[SubscriptionQueue] setTableVisible applied', {
        tableId,
        nextCount: nextSet.size,
        visibleCount: SubscriptionQueue.getVisibleCount(),
        invisQueue: invisibleQueue.length,
        time: new Date().toISOString(),
      })
    } catch {}
  },
  // For testing/inspection
  __debug__: {
    // Removed unused getUniverse, getInactiveQueue, getVisible, getLastUnsubscribedAt
    reset() {
      universe = []
      visible.clear()
      ignored.clear()
      invisibleQueue.length = 0
      invisibleSet.clear()
      lastUnsubscribedAt.clear()
    },
  },
}
