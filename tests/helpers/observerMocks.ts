/**
 * Reusable mock implementations for IntersectionObserver and ResizeObserver
 * Used across test files to reduce boilerplate
 */

/**
 * Mock IntersectionObserver that can be used as a test double
 */
export class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  callback?: IntersectionObserverCallback

  constructor(
    callback?: IntersectionObserverCallback,
    _options?: IntersectionObserverInit
  ) {
    this.callback = callback
  }

  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

/**
 * Mock ResizeObserver that can be used as a test double
 */
export class MockResizeObserver implements ResizeObserver {
  callback?: ResizeObserverCallback

  constructor(callback?: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(_target: Element, _options?: ResizeObserverOptions): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

/**
 * Setup global mocks for IntersectionObserver and ResizeObserver
 * Call this in beforeEach or at the start of a test
 *
 * @returns Cleanup function to restore original implementations
 */
export function setupObserverMocks(): () => void {
  const origIO = (globalThis as any).IntersectionObserver
  const origRO = (globalThis as any).ResizeObserver

  ;(globalThis as any).IntersectionObserver = MockIntersectionObserver
  ;(globalThis as any).ResizeObserver = MockResizeObserver

  // Return cleanup function
  return () => {
    ;(globalThis as any).IntersectionObserver = origIO
    ;(globalThis as any).ResizeObserver = origRO
  }
}

/**
 * Create a custom IntersectionObserver mock with configurable behavior
 * Useful for testing specific intersection scenarios
 */
export function createIntersectionObserverMock(
  entries: Partial<IntersectionObserverEntry>[] = []
): typeof IntersectionObserver {
  return class extends MockIntersectionObserver {
    observe(_target: Element): void {
      // Immediately trigger callback with provided entries
      if (this.callback && entries.length > 0) {
        this.callback(entries as IntersectionObserverEntry[], this)
      }
    }
  } as any
}

/**
 * Create a custom ResizeObserver mock with configurable behavior
 * Useful for testing specific resize scenarios
 */
export function createResizeObserverMock(
  entries: Partial<ResizeObserverEntry>[] = []
): typeof ResizeObserver {
  return class extends MockResizeObserver {
    observe(_target: Element): void {
      // Immediately trigger callback with provided entries
      if (this.callback && entries.length > 0) {
        this.callback(entries as ResizeObserverEntry[], this)
      }
    }
  } as any
}
