// src/utils/scanner.ts
import type { ScannerResult } from '../test-task-types'

export function dedupeByPairAddress<T extends { pairAddress?: string }>(
  list: readonly (ScannerResult | T)[],
): (ScannerResult | T)[] {
  const seen = new Set<string>()
  const out: (ScannerResult | T)[] = []
  for (const it of list) {
    const k = (it.pairAddress ?? '').toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}
