import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import TokensPane from '../src/components/TokensPane'

const mockFilters = {
  rankBy: 'volume',
  orderBy: 'desc',
  isNotHP: true,
}

const mockState = {
  byId: {},
  pages: {},
  version: 0,
}

const mockDispatch = () => {}

class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('TokensPane', () => {
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

  it('renders without crashing', () => {
    const { container } = render(
      <TokensPane
        title="Test Pane"
        filters={mockFilters as any}
        page={1}
        state={mockState as any}
        dispatch={mockDispatch as any}
        defaultSort={{ key: 'mcap', dir: 'desc' }}
      />,
    )
    expect(container).toBeTruthy()
  })
})
