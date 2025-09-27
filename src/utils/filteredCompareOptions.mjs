/**
 * Compute filtered compare options for the Detail modal.
 * Pure function, side-effect free, suitable for unit testing.
 *
 * Rules (replicated from DetailModal.tsx):
 * - If the modal is not open, return an empty list.
 * - Exclude the currently selected row (by id).
 * - Deduplicate by id (first occurrence wins) to avoid duplicate keys/options across tables.
 * - If no search query, return the first 100 of the base list.
 * - If there is a search query, case-insensitive match on tokenName or tokenSymbol, then cap to 100.
 *
 * @template T extends { id: string }
 * @param {Object} params
 * @param {boolean} params.open
 * @param {T[]} params.allRows
 * @param {T|null|undefined} params.currentRow
 * @param {string|undefined|null} params.compareSearch
 * @returns {T[]}
 */
export function computeFilteredCompareOptions({
  open,
  allRows,
  currentRow,
  compareSearch,
  includeStale = false,
  includeDegraded = false,
}) {
  if (!open) return []
  const currentId = currentRow && typeof currentRow === 'object' ? currentRow.id : undefined
  const base = Array.isArray(allRows)
    ? allRows.filter((r) => (currentId === undefined ? true : r?.id !== currentId))
    : []
  // Deduplicate by id (keep first occurrence)
  const uniq = uniqueById(base)
  const ONE_HOUR_MS = 60 * 60 * 1000
  const now = Date.now()
  const freshnessOf = (r) => {
    const s = typeof r?.scannerAt === 'number' ? r.scannerAt : null
    const t = typeof r?.tickAt === 'number' ? r.tickAt : null
    const p = typeof r?.pairStatsAt === 'number' ? r.pairStatsAt : null
    const any = !!(s || t || p)
    if (!any) return 'degraded'
    const recent = [s, t, p].some((v) => typeof v === 'number' && now - v < ONE_HOUR_MS)
    return recent ? 'fresh' : 'stale'
  }
  // Fresh is always included; stale/degraded controlled by flags
  const byFreshness = uniq.filter((r) => {
    const f = freshnessOf(r)
    if (f === 'fresh') return true
    if (f === 'stale') return !!includeStale
    if (f === 'degraded') return !!includeDegraded
    return true
  })

  const topN = (arr) => (Array.isArray(arr) ? arr.slice(0, 100) : [])
  if (!compareSearch) return topN(byFreshness)
  const q = String(compareSearch).toLowerCase()
  const safeIncludes = (s) =>
    String(s || '')
      .toLowerCase()
      .includes(q)
  return topN(byFreshness.filter((r) => safeIncludes(r?.tokenName) || safeIncludes(r?.tokenSymbol)))
}

/**
 * Return a new array with unique items by id. First occurrence wins to preserve stable ordering.
 * @template T extends { id: string }
 * @param {T[]} list
 * @returns {T[]}
 */
export function uniqueById(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const item of list) {
    const id = item?.id
    if (id == null) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}
