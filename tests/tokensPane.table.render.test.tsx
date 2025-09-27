import '@testing-library/jest-dom/vitest'
import '@testing-library/jest-dom/vitest'
import React, { useReducer } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TokensPane from '../src/components/TokensPane'
import { tokensReducer, initialState } from '../src/tokens.reducer.js'
import fs from 'node:fs/promises'
import path from 'node:path'

async function loadFixture(name: 'scanner.trending.json' | 'scanner.new.json') {
  const p = path.resolve(process.cwd(), 'tests', 'fixtures', name)
  const txt = await fs.readFile(p, 'utf-8')
  return JSON.parse(txt)
}

// Mock the scanner client to return real fixtures mapped through real util
vi.mock('../src/scanner.client.js', async (orig) => {
  const mod = await (orig as any)()
  const real = mod as Record<string, any>
  const { mapScannerPage } = await import('../src/scanner.client.js')
  return {
    ...real,
    fetchScanner: async (params: Record<string, any>) => {
      const which = params?.rankBy === 'volume' ? 'scanner.trending.json' : 'scanner.new.json'
      const raw = await loadFixture(which as any)
      const tokens = mapScannerPage(raw)
      return { raw, tokens }
    },
  }
})

// Environment stubs used by Table within TokensPane
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('TokensPane→Table integration: renders DOM rows post-fetch', () => {
  const origIO = (global as any).IntersectionObserver
  const origRO = (global as any).ResizeObserver

  beforeEach(() => {
    ;(global as any).IntersectionObserver = IO as any
    ;(global as any).ResizeObserver = IO as any
  })
  afterEach(() => {
    ;(global as any).IntersectionObserver = origIO
    ;(global as any).ResizeObserver = origRO
  })

  function makeState() {
    return { byId: {}, pages: {}, version: 0 }
  }

  it('mounts, fetches, dispatches, and renders > 0 rows', async () => {
    function Host() {
      const [state, dispatch] = useReducer(tokensReducer as any, initialState as any)
      return (
        <TokensPane
          title="New Tokens"
          filters={{ rankBy: 'age', orderBy: 'desc', isNotHP: true } as any}
          page={201}
          state={state}
          dispatch={dispatch as any}
          defaultSort={{ key: 'age', dir: 'desc' }}
          clientFilters={{ chains: ['ETH', 'SOL', 'BASE', 'BSC'] }}
        />
      )
    }

    render(<Host />)

    // Canary should show > 0 rows after fetch/dispatch pipeline completes
    const canary = await screen.findByTestId('rows-count-new')
    await waitFor(() => {
      const txt = canary.textContent || ''
      const n = parseInt(/(\d+)/.exec(txt)?.[1] ?? '0', 10)
      expect(n).toBeGreaterThan(0)
    })
  })
})
