// Type declarations for filteredCompareOptions.mjs (module-aware .d.ts so imports using the .mjs path pick it up)
export {};

export function computeFilteredCompareOptions<T extends { id: string }>(params: {
  open: boolean
  allRows: T[]
  currentRow?: T | null
  compareSearch?: string | null
  includeStale?: boolean
  includeDegraded?: boolean
}): T[]

export function filterRowsByTokenQuery<T extends { id: string; tokenName?: string; tokenSymbol?: string; scannerAt?: number; tickAt?: number; pairStatsAt?: number }>(params: {
  rows: T[]
  query?: string
  includeStale?: boolean
  includeDegraded?: boolean
}): Set<string>

export function uniqueById<T extends { id: string }>(arr: T[]): T[]

