import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'
import fs from 'node:fs/promises'

import path from 'node:path'

async function loadFixture(name: 'scanner.trending.json' | 'scanner.new.json') {
  const p = path.resolve(process.cwd(), 'tests', 'fixtures', name)
  const txt = await fs.readFile(p, 'utf-8')
  return JSON.parse(txt)
}

describe.skip('App boot logging diagnostics', () => {
  const originalFetch = global.fetch
  const originalWS = (global as any).WebSocket
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Bypass boot overlay
    ;(globalThis as any).window = global.window
    ;(window as any).__BYPASS_BOOT__ = true

    // Minimal stubs for observers used by Table
    ;(window as any).IntersectionObserver = class {
      constructor() {}
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any
    ;(window as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any

    // Stub WebSocket
    ;(global as any).WebSocket = class {
      static OPEN = 1
      readyState = 1
      onopen: any
      onmessage: any
      onclose: any
      onerror: any
      send() {}
      close() {}
    } as any

    // Mock fetch: respond based on rankBy param
    global.fetch = vi.fn(async (url: RequestInfo) => {
      const href = String(url)
      const u = new URL(href)
      const rankBy = u.searchParams.get('rankBy')
      if (rankBy === 'volume') {
        const json = await loadFixture('scanner.trending.json')
        return new Response(JSON.stringify(json), { status: 200 })
      } else if (rankBy === 'age') {
        const json = await loadFixture('scanner.new.json')
        return new Response(JSON.stringify(json), { status: 200 })
      }
      return new Response(JSON.stringify({ pairs: [] }), { status: 200 })
    }) as any
  })

  afterEach(() => {
    logSpy?.mockRestore()
    errorSpy?.mockRestore()
    global.fetch = originalFetch as any
    ;(global as any).WebSocket = originalWS
  })

  it('emits reducer and pane logs after successful boot requests', async () => {
    render(<App />)

    // Expect boot logs from App indicating scanner dispatches occurred
    await waitFor(() => {
      const calls = logSpy.mock.calls.map((c) => String(c[0]))
      const okLogs = calls.filter((s) =>
        s.includes('[App.tsx] dispatching scanner/pairsTokens') || s.includes('[App.tsx] fetchScanner: '),
      )
      expect(okLogs.length).toBeGreaterThanOrEqual(1)
    })

    // Expect TokensPane to derive rows with rendering > 0 for at least one pane
    await waitFor(() => {
      const paneCalls = logSpy.mock.calls
        .filter((c) => String(c[0]).includes('] rows derived'))
        .map((c) => c[1])
        .filter(Boolean) as { rendering?: number }[]
      const anyRendered = paneCalls.some((o) => (o?.rendering ?? 0) > 0)
      expect(anyRendered).toBe(true)
    })

    // Canary in the DOM also reflects >0 rows for at least one pane
    const trendingCanary = await screen.findByTestId('rows-count-trending')
    const newCanary = await screen.findByTestId('rows-count-new')
    const trendingText = trendingCanary.textContent || ''
    const newText = newCanary.textContent || ''
    console.error('DEBUG trendingText:', trendingText)
    console.error('DEBUG newText:', newText)
    const parse = (s: string) => parseInt(/(\d+)/.exec(s)?.[1] ?? '0', 10)
    const totalRows = parse(trendingText) + parse(newText)
    if (totalRows <= 0) {
      throw new Error(`Rendered row count is zero. trendingText: '${trendingText}', newText: '${newText}'`)
    }
    expect(totalRows).toBeGreaterThan(0)
  })
})
