import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clearWsConsole,
  getWsConsoleHistory,
  logWsInfo,
  logWsSuccess,
  logWsError,
  onWsConsoleChange,
} from '../ws.console.bus.js'

type WsConsoleLevel = 'info' | 'success' | 'error'
interface WsConsoleEntry {
  id: number
  ts: number
  level: WsConsoleLevel
  text: string
}

export default function WsConsole() {
  const [entries, setEntries] = useState<WsConsoleEntry[]>(
    () => getWsConsoleHistory() as WsConsoleEntry[],
  )
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [copied, setCopied] = useState(false)
  // Filter checkboxes
  const [showError, setShowError] = useState(true)
  const [showSub, setShowSub] = useState(true)
  const [showUnsub, setShowUnsub] = useState(true)
  const [showScannerPairs, setShowScannerPairs] = useState(true)
  const [showTick, setShowTick] = useState(true)
  const [showPairStats, setShowPairStats] = useState(true)
  const [showWpegPrices, setShowWpegPrices] = useState(true)

  // Install global sink so ws.mapper.js can stream here via __WS_CONSOLE_LOG__
  useEffect(() => {
    try {
      ;(
        window as unknown as { __WS_CONSOLE_LOG__?: (k: string, t: string) => void }
      ).__WS_CONSOLE_LOG__ = (kind: string, text: string) => {
        const k = kind
        if (k === 'error') logWsError(text)
        else if (k === 'success') logWsSuccess(text)
        else logWsInfo(text)
      }
    } catch {}
    return () => {
      try {
        ;(window as unknown as { __WS_CONSOLE_LOG__?: unknown }).__WS_CONSOLE_LOG__ = undefined
      } catch {}
    }
  }, [])

  useEffect(() => {
    const handleChange = (next: WsConsoleEntry[]) => {
      // Only keep the most recent 100 logs
      setEntries(next.slice(-100))
    }
    const off = onWsConsoleChange(handleChange)
    // Initial trim in case getWsConsoleHistory returns more than 100
    setEntries((prev) => prev.slice(-100))
    return () => {
      off()
    }
  }, [])

  // Helper to match entry text to filter type
  function matchesFilter(e: WsConsoleEntry) {
    // Error level
    if (e.level === 'error' && !showError) return false
    // Sub/Unsub detection
    const txt = e.text.toLowerCase()
    if (txt.includes('subscribe') && !txt.includes('unsubscribe') && !showSub) return false
    if (txt.includes('unsubscribe') && !showUnsub) return false
    // Event types
    if (txt.includes('scanner-pairs') && !showScannerPairs) return false
    if (txt.includes('tick') && !showTick) return false
    if (txt.includes('pair-stats') && !showPairStats) return false
    if (txt.includes('wpeg-prices') && !showWpegPrices) return false
    // If none of the above, allow info/success if not filtered out
    return true
  }

  const visibleEntries = useMemo(() => {
    return entries.filter(matchesFilter)
  }, [
    entries,
    showError,
    showSub,
    showUnsub,
    showScannerPairs,
    showTick,
    showPairStats,
    showWpegPrices,
  ])

  const textBlob = useMemo(() => {
    return visibleEntries
      .map((e) => {
        const ts = new Date(e.ts).toISOString()
        return `[${ts}] ${e.level.toUpperCase()} ${e.text}`
      })
      .join('\n')
  }, [visibleEntries])

  function onCopyClick() {
    // Wrap the async clipboard call to satisfy no-misused-promises on onClick
    void (async () => {
      try {
        await navigator.clipboard.writeText(textBlob)
        setCopied(true)
        setTimeout(() => {
          setCopied(false)
        }, 1000)
      } catch (err) {
        logWsInfo('Clipboard copy failed; see devtools for details.')
        try {
          console.error('[WsConsole] copy failed', err)
        } catch {}
      }
    })()
  }

  return (
    <div className="ws-console">
      <div className="ws-console__header">
        <div className="ws-console__title">WS Console</div>
        <div className="ws-console__actions">
          {/* Filter checkboxes */}
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={showError}
              onChange={(e) => {
                setShowError(e.target.checked)
              }}
            />{' '}
            Err
          </label>
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={showSub}
              onChange={(e) => {
                setShowSub(e.target.checked)
              }}
            />{' '}
            Sub
          </label>
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={showUnsub}
              onChange={(e) => {
                setShowUnsub(e.target.checked)
              }}
            />{' '}
            Uns
          </label>
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={showScannerPairs}
              onChange={(e) => {
                setShowScannerPairs(e.target.checked)
              }}
            />{' '}
            scan
          </label>
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={showTick}
              onChange={(e) => {
                setShowTick(e.target.checked)
              }}
            />{' '}
            tick
          </label>
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={showPairStats}
              onChange={(e) => {
                setShowPairStats(e.target.checked)
              }}
            />{' '}
            stat
          </label>
          <label style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={showWpegPrices}
              onChange={(e) => {
                setShowWpegPrices(e.target.checked)
              }}
            />{' '}
            wpeg
          </label>
          <button type="button" className="btn" onClick={onCopyClick} title="Copy to clipboard">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              clearWsConsole()
            }}
            title="Clear history"
          >
            Clear
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className="ws-console__scroll">
        {visibleEntries.length === 0 ? (
          <div className="ws-console__empty">No messages yet</div>
        ) : (
          visibleEntries.map((e) => {
            const colorStyle =
              e.level === 'error'
                ? { color: 'var(--accent-down)' }
                : e.level === 'success'
                  ? { color: 'var(--accent-up)' }
                  : undefined
            const ts = new Date(e.ts).toLocaleTimeString()
            return (
              <div key={e.id} className="ws-console__line" style={colorStyle}>
                <span className="ws-console__ts">{ts}</span>
                <span className="ws-console__level">[{e.level}]</span>
                <span className="ws-console__text">{e.text}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
