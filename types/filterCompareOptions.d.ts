export interface CompareRowLike {
  id: string
  tokenName: string
  tokenSymbol: string
}

export interface ComputeFilteredParams<T extends CompareRowLike> {
  open: boolean
  allRows: T[]
  currentRow: T | null | undefined
  compareSearch: string | null | undefined
}

export declare function computeFilteredCompareOptions<T extends CompareRowLike>(
  params: ComputeFilteredParams<T>,
): T[]
