// Blur interactive elements after mouse clicks to avoid persistent "memory"
// focus styles for mouse users while preserving keyboard focus outlines.
// This keeps :focus-visible behavior intact for keyboard navigation.

(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  let lastPointerType = ''
  try {
    window.addEventListener(
      'pointerdown',
      (ev: PointerEvent) => {
        try {
          lastPointerType = ev.pointerType || ''
        } catch {}
      },
      true,
    )

    window.addEventListener(
      'click',
      (ev: MouseEvent) => {
        try {
          // Only blur when the last pointer was a mouse to avoid interfering
          // with keyboard or assistive interactions.
          if (lastPointerType !== 'mouse') return
          const target = ev.target as HTMLElement | null
          if (!target) return
          // Find nearest actionable element we want to blur after mouse click.
          const actionable = target.closest('button, a.link') as HTMLElement | null
          if (actionable && typeof actionable.blur === 'function') {
            // Defer blur slightly to allow click handlers to run first.
            window.setTimeout(() => {
              try {
                actionable.blur()
              } catch {}
            }, 0)
          }
        } catch {}
      },
      true,
    )
  } catch {
    /* noop */
  }
})()

