// filepath: /home/pboling/WebstormProjects/dexcelerate-fe-test/src/hooks/useCompareSubscription.ts
import { useEffect, useRef, useState } from 'react'
import { onUpdate } from '../updates.bus'
import {
  buildPairUnsubscription,
  buildPairStatsUnsubscription,
  buildPairX5Subscription,
  buildPairStatsX5Subscription,
} from '../ws.mapper.js'

export interface MinimalCompareRow {
  id: string
  pairAddress?: string
  tokenAddress?: string
  chain: string
}

interface UseCompareSubscriptionParams {
  open: boolean
  compareRow: MinimalCompareRow | null
  allRows: MinimalCompareRow[]
  toChainId: (c: string | number | undefined) => string
  applyCompareSnapshot: (latestId: string) => void
  getRowById: (id: string) => MinimalCompareRow | undefined
  hasSeedData: boolean
  debounceMs?: number
}

export function useCompareSubscription({
  open,
  compareRow,
  allRows,
  toChainId,
  applyCompareSnapshot,
  getRowById,
  hasSeedData,
  debounceMs = 300,
}: UseCompareSubscriptionParams) {
  const [isSubscribing, setIsSubscribing] = useState(false)
  const [canLiveStream, setCanLiveStream] = useState(false)
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null)
  const subscribedIdRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | undefined>(undefined)
  const firstUpdateSeenRef = useRef(false)
  const lastLiveIdRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load last live id from localStorage once
  useEffect(() => {
    try {
      lastLiveIdRef.current = window.localStorage.getItem('detailModal.lastCompareLiveId')
    } catch {}
  }, [])

  const persistLastLive = (id: string) => {
    lastLiveIdRef.current = id
    try {
      window.localStorage.setItem('detailModal.lastCompareLiveId', id)
    } catch {}
  }

  const revertToLastLive = () => {
    if (!lastLiveIdRef.current || !open) return null
    return lastLiveIdRef.current
  }

  // Resolve websocket reference (if already opened by App)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      type AppWindow = Window & { __APP_WS__?: WebSocket }
      wsRef.current = (window as AppWindow).__APP_WS__
    }
  }, [])

  // Compute canLiveStream on changes
  useEffect(() => {
    const ok = !!(open && compareRow?.pairAddress && compareRow.tokenAddress)
    setCanLiveStream(ok)
    if (!ok) {
      setIsSubscribing(false)
    }
  }, [open, compareRow?.id, compareRow?.pairAddress, compareRow?.tokenAddress])

  // If we already have seed data for the current compare id, ensure we don't show Subscribing… for long
  useEffect(() => {
    if (!open || !compareRow) return
    if (hasSeedData && subscribedIdRef.current === compareRow.id) {
      setIsSubscribing(false)
      firstUpdateSeenRef.current = true
    }
  }, [open, compareRow, compareRow?.id, hasSeedData])

  // Manage subscription with debounce
  useEffect(() => {
    // Cleanup helper
    const unsubscribe = () => {
      const ws = wsRef.current
      if (abortRef.current) {
        try {
          abortRef.current.abort()
        } catch {}
        abortRef.current = null
      }
      if (subscribedIdRef.current && ws && ws.readyState === WebSocket.OPEN) {
        const prev = allRows.find((r) => r.id === subscribedIdRef.current)
        if (prev?.pairAddress && prev.tokenAddress) {
          try {
            ws.send(
              JSON.stringify(
                buildPairUnsubscription({
                  pair: prev.pairAddress,
                  token: prev.tokenAddress,
                  chain: prev.chain,
                }),
              ),
            )
          } catch {}
          try {
            ws.send(
              JSON.stringify(
                buildPairStatsUnsubscription({
                  pair: prev.pairAddress,
                  token: prev.tokenAddress,
                  chain: prev.chain,
                }),
              ),
            )
          } catch {}
        }
      }
      subscribedIdRef.current = null
    }

    if (!open) {
      unsubscribe()
      return
    }

    if (!canLiveStream || !compareRow) {
      unsubscribe()
      return () => {
        unsubscribe()
      }
    }

    // Debounce rapid compare changes
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    setIsSubscribing(true)
    firstUpdateSeenRef.current = false

    debounceRef.current = setTimeout(() => {
      // Re-resolve the WS in case it became available after mount
      try {
        const latestWs = (window as unknown as { __APP_WS__?: WebSocket }).__APP_WS__
        if (latestWs) wsRef.current = latestWs
      } catch {}
      const ws = wsRef.current
      if (!ws) return
      const doSubscribe = () => {
        if (subscribedIdRef.current === compareRow.id) {
          if (hasSeedData) setIsSubscribing(false)
          return
        }
        unsubscribe()
        if (compareRow.pairAddress && compareRow.tokenAddress) {
          abortRef.current = new AbortController()
          const variants = new Set<string>([compareRow.chain, toChainId(compareRow.chain)])
          for (const chainVariant of variants) {
            if (abortRef.current.signal.aborted) break
            try {
              ws.send(
                JSON.stringify(
                  buildPairX5Subscription({
                    pair: compareRow.pairAddress,
                    token: compareRow.tokenAddress,
                    chain: chainVariant,
                  }),
                ),
              )
            } catch {}
            try {
              ws.send(
                JSON.stringify(
                  buildPairStatsX5Subscription({
                    pair: compareRow.pairAddress,
                    token: compareRow.tokenAddress,
                    chain: chainVariant,
                  }),
                ),
              )
            } catch {}
          }
          subscribedIdRef.current = compareRow.id
          if (hasSeedData) {
            setIsSubscribing(false)
            firstUpdateSeenRef.current = true
            persistLastLive(compareRow.id)
          }
        } else {
          setIsSubscribing(false)
        }
      }

      if (ws.readyState === WebSocket.OPEN) {
        doSubscribe()
      } else if (ws.readyState === WebSocket.CONNECTING) {
        const handler = () => {
          doSubscribe()
        }
        try {
          ws.addEventListener('open', handler, { once: true })
        } catch {}
      } else {
        // Socket may be CLOSED or CLOSING; try to discover a fresh one on next render via polling effect
      }
    }, debounceMs)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      // We intentionally do NOT unsubscribe here immediately when compare changes;
      // unsubscribe happens right before the next subscription inside doSubscribe to minimize churn.
      unsubscribe()
    }
  }, [open, compareRow, compareRow?.id, canLiveStream, hasSeedData, debounceMs, allRows, toChainId])

  // Listen for onUpdate events for the compare row; mark subscription complete when first update arrives
  useEffect(() => {
    if (!open || !compareRow || !canLiveStream) return
    const chainId = toChainId(compareRow.chain)
    const chainName = compareRow.chain
    const pairStatsKeyNumeric =
      compareRow.pairAddress && compareRow.tokenAddress
        ? `${compareRow.pairAddress}|${compareRow.tokenAddress}|${chainId}`
        : null
    const pairStatsKeyName =
      compareRow.pairAddress && compareRow.tokenAddress
        ? `${compareRow.pairAddress}|${compareRow.tokenAddress}|${chainName}`
        : null
    const tickKeyNumeric = compareRow.tokenAddress ? `${compareRow.tokenAddress}|${chainId}` : null
    const tickKeyName = compareRow.tokenAddress ? `${compareRow.tokenAddress}|${chainName}` : null

    const off = onUpdate((e) => {
      if (
        e.key !== pairStatsKeyNumeric &&
        e.key !== pairStatsKeyName &&
        e.key !== tickKeyNumeric &&
        e.key !== tickKeyName
      )
        return
      const latest = getRowById(compareRow.id)
      if (latest) {
        applyCompareSnapshot(compareRow.id)
      }
      if (!firstUpdateSeenRef.current) {
        firstUpdateSeenRef.current = true
        setIsSubscribing(false)
        persistLastLive(compareRow.id)
      }
      setLastUpdateAt(Date.now())
    })
    return () => {
      try {
        off()
      } catch {}
    }
  }, [open, compareRow, compareRow?.id, canLiveStream, toChainId, getRowById, applyCompareSnapshot])

  return { isSubscribing, canLiveStream, lastUpdateAt, revertToLastLive }
}

export default useCompareSubscription
