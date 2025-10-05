import '@testing-library/jest-dom/vitest'

// Provide lightweight global stubs for observers used by Table/Row and other components
class __MockIntersectionObserver {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(_cb?: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  observe(_target: Element) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  unobserve(_target: Element) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
class __MockResizeObserver {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(_cb?: ResizeObserverCallback) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  observe(_target: Element) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  unobserve(_target: Element) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  disconnect() {}
}

class __MockMutationObserver {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(_cb?: MutationCallback) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  observe(_target: Node, _options?: MutationObserverInit) {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  disconnect() {}
  takeRecords(): MutationRecord[] { return [] }
}

// Install stubs only if not already provided by a test
if (typeof (globalThis as any).IntersectionObserver === 'undefined') {
  ;(globalThis as any).IntersectionObserver = __MockIntersectionObserver as any
}
if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  ;(globalThis as any).ResizeObserver = __MockResizeObserver as any
}
if (typeof (globalThis as any).MutationObserver === 'undefined') {
  ;(globalThis as any).MutationObserver = __MockMutationObserver as any
}

// requestAnimationFrame / cancelAnimationFrame shims for JSDOM
if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number
}
if (typeof (globalThis as any).cancelAnimationFrame !== 'function') {
  ;(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id)
}

// navigator.clipboard shim to avoid errors when components trigger copy behavior
if (!(globalThis as any).navigator) {
  ;(globalThis as any).navigator = {} as any
}
if (!('clipboard' in (globalThis as any).navigator)) {
  ;(globalThis as any).navigator.clipboard = {
    writeText: async (_text: string) => {},
  }
}

// URL blob shims used by Table export helpers
if (!('URL' in globalThis)) {
  ;(globalThis as any).URL = {} as any
}
if (typeof (globalThis as any).URL.createObjectURL !== 'function') {
  ;(globalThis as any).URL.createObjectURL = () => 'blob://local-test'
}
if (typeof (globalThis as any).URL.revokeObjectURL !== 'function') {
  ;(globalThis as any).URL.revokeObjectURL = () => {}
}

// CustomEvent shim (older JSDOM environments)
try {
  // @ts-ignore
  if (typeof (globalThis as any).CustomEvent !== 'function') {
    // Minimal CustomEvent polyfill
    // eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
    class __CustomEvent<T = any> extends Event {
      detail: T | undefined
      constructor(type: string, params?: { detail?: T }) {
        super(type)
        this.detail = params?.detail
      }
    }
    ;(globalThis as any).CustomEvent = __CustomEvent as any
  }
} catch {}
