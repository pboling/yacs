// filepath: /home/pboling/WebstormProjects/dexcelerate-fe-test/src/hooks/useCompareSubscription.ts
import { useEffect, useRef, useState } from 'react'
import { onUpdate } from '../updates.bus'
import {
  buildPairSubscription,
  buildPairStatsSubscription,
  buildPairUnsubscription,
  buildPairStatsUnsubscription
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
  getRowById: (id: string) => any
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
  const subscribedIdRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | undefined>(undefined)
  const firstUpdateSeenRef = useRef(false)

  // Resolve websocket reference (if already opened by App)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      wsRef.current = (window as any).__APP_WS__ as WebSocket | undefined
    }
  }, [])

  // Compute canLiveStream on changes
  useEffect(() => {
    const ok = !!(open && compareRow && compareRow.pairAddress && compareRow.tokenAddress)
    setCanLiveStream(ok)
    if (!ok) {
      setIsSubscribing(false)
    }
  }, [open, compareRow?.id, compareRow?.pairAddress, compareRow?.tokenAddress])

  // Manage subscription with debounce
  useEffect(() => {
    // Cleanup helper
    const unsubscribe = () => {
      const ws = wsRef.current
      if (subscribedIdRef.current && ws && ws.readyState === WebSocket.OPEN) {
        const prev = allRows.find(r => r.id === subscribedIdRef.current)
        if (prev?.pairAddress && prev.tokenAddress) {
          try { ws.send(JSON.stringify(buildPairUnsubscription({ pair: prev.pairAddress, token: prev.tokenAddress, chain: prev.chain }))) } catch {}
          try { ws.send(JSON.stringify(buildPairStatsUnsubscription({ pair: prev.pairAddress, token: prev.tokenAddress, chain: prev.chain }))) } catch {}
        }
      }
      subscribedIdRef.current = null
    }

    if (!open) {
      unsubscribe()
      return () => {}
    }

    if (!canLiveStream || !compareRow) {
      unsubscribe()
      return () => { unsubscribe() }
    }

    // Debounce rapid compare changes
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    setIsSubscribing(true)
    firstUpdateSeenRef.current = false

    debounceRef.current = setTimeout(() => {
      const ws = wsRef.current
      if (!ws) return
      const doSubscribe = () => {
        if (subscribedIdRef.current === compareRow.id) {
          // Already subscribed
          if (hasSeedData) {
            setIsSubscribing(false)
          }
          return
        }
        // Unsubscribe previous
        unsubscribe()
        if (compareRow.pairAddress && compareRow.tokenAddress) {
          try { ws.send(JSON.stringify(buildPairSubscription({ pair: compareRow.pairAddress, token: compareRow.tokenAddress, chain: compareRow.chain }))) } catch {}
          try { ws.send(JSON.stringify(buildPairStatsSubscription({ pair: compareRow.pairAddress, token: compareRow.tokenAddress, chain: compareRow.chain }))) } catch {}
          subscribedIdRef.current = compareRow.id
          if (hasSeedData) {
            // Seed counts as first data point
            setIsSubscribing(false)
            firstUpdateSeenRef.current = true
          }
        } else {
          setIsSubscribing(false)
        }
      }

      if (ws.readyState === WebSocket.OPEN) {
        doSubscribe()
      } else if (ws.readyState === WebSocket.CONNECTING) {
        const handler = () => { doSubscribe() }
        try { ws.addEventListener('open', handler, { once: true }) } catch {}
      }
    }, debounceMs)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      // We intentionally do NOT unsubscribe here immediately when compare changes;
      // unsubscribe happens right before the next subscription inside doSubscribe to minimize churn.
      if (!open) {
        unsubscribe()
      }
    }
  }, [open, compareRow?.id, canLiveStream, hasSeedData, debounceMs])

  // Listen for onUpdate events for the compare row; mark subscription complete when first update arrives
  useEffect(() => {
    if (!open || !compareRow || !canLiveStream) return
    const chainId = toChainId(compareRow.chain)
    const pairStatsKey = compareRow.pairAddress && compareRow.tokenAddress ? `${compareRow.pairAddress}|${compareRow.tokenAddress}|${chainId}` : null
    const tickKey = compareRow.tokenAddress ? `${compareRow.tokenAddress}|${chainId}` : null

    const off = onUpdate((e) => {
      if (e.key !== pairStatsKey && e.key !== tickKey) return
      const latest = getRowById(compareRow.id)
      if (latest) {
        applyCompareSnapshot(compareRow.id)
      }
      if (!firstUpdateSeenRef.current) {
        firstUpdateSeenRef.current = true
        setIsSubscribing(false)
      }
    })
    return () => { try { off() } catch {} }
  }, [open, compareRow?.id, canLiveStream])

  return { isSubscribing, canLiveStream }
}

export default useCompareSubscription

