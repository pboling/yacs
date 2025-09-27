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
  const [errorsOnly, setErrorsOnly] = useState(false)

  // Install global sink so ws.mapper.js can stream here via __WS_CONSOLE_LOG__
  useEffect(() => {
    try {
      ;(
        window as unknown as { __WS_CONSOLE_LOG__?: (k: string, t: string) => void }
      ).__WS_CONSOLE_LOG__ = (kind: string, text: string) => {
        const k = String(kind)
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
    return onWsConsoleChange((list) => {
      setEntries(list as WsConsoleEntry[])
      try {
        const el = scrollerRef.current
        if (el) el.scrollTop = el.scrollHeight
      } catch {}
    })
  }, [])

  const visibleEntries = useMemo(() => {
    return errorsOnly ? entries.filter((e) => e.level === 'error') : entries
  }, [entries, errorsOnly])

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
          <button
            type="button"
            className="btn"
            aria-pressed={errorsOnly}
            onClick={() => {
              setErrorsOnly((v) => !v)
            }}
            title="Show only error messages"
          >
            Errors Only
          </button>
          <button type="button" className="btn" onClick={onCopyClick} title="Copy to clipboard">
            {copied ? 'Copied' : 'Copy'}
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
