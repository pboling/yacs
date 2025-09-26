/**
 * Compute filtered compare options for the Detail modal.
 * Pure function, side-effect free, suitable for unit testing.
 *
 * Rules (replicated from DetailModal.tsx):
 * - If the modal is not open, return an empty list.
 * - Exclude the currently selected row (by id).
 * - If no search query, return the first 100 of the base list.
 * - If there is a search query, case-insensitive match on tokenName or tokenSymbol, then cap to 100.
 *
 * @template T
 * @param {Object} params
 * @param {boolean} params.open
 * @param {T[]} params.allRows
 * @param {T|null|undefined} params.currentRow
 * @param {string|undefined|null} params.compareSearch
 * @returns {T[]}
 */
export function computeFilteredCompareOptions({ open, allRows, currentRow, compareSearch }) {
  if (!open) return []
  const currentId = currentRow && typeof currentRow === 'object' ? currentRow.id : undefined
  const base = Array.isArray(allRows)
    ? allRows.filter((r) => (currentId === undefined ? true : r?.id !== currentId))
    : []
  const topN = (arr) => (Array.isArray(arr) ? arr.slice(0, 100) : [])
  if (!compareSearch) return topN(base)
  const q = String(compareSearch).toLowerCase()
  const safeIncludes = (s) => String(s || '').toLowerCase().includes(q)
  return topN(base.filter((r) => safeIncludes(r?.tokenName) || safeIncludes(r?.tokenSymbol)))
}
