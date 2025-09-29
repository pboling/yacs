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
  // Deduplicate by id (keep first occurrence)
  const uniq = uniqueById(Array.isArray(allRows) ? allRows : [])
  // eslint-disable-next-line no-console
  console.log('After uniqueById:', uniq)
  // Exclude the currently selected row (by id)
  const currentId = currentRow && typeof currentRow === 'object' ? currentRow.id : undefined
  const base = uniq.filter((r) => (currentId === undefined ? true : r?.id !== currentId))
  // eslint-disable-next-line no-console
  console.log('After exclude currentRow:', base)
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
  const byFreshness = base.filter((r) => {
    const f = freshnessOf(r)
    // eslint-disable-next-line no-console
    console.log('Row', r.id, 'freshness:', f)
    if (f === 'fresh') return true
    if (f === 'stale') return !!includeStale
    if (f === 'degraded') return !!includeDegraded
    return true
  })
  // eslint-disable-next-line no-console
  console.log('After freshness filter:', byFreshness)

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
 * Live-filter helper for tables: returns a Set of row ids that match the token query and freshness policy.
 * Mirrors DetailModal rules but without the 100-item cap and without open/currentRow constraints.
 * @param {Object} params
 * @param {{id:string; tokenName?:string; tokenSymbol?:string; scannerAt?:number; tickAt?:number; pairStatsAt?:number;}[]} params.rows
 * @param {string} [params.query]
 * @param {boolean} [params.includeStale=false]
 * @param {boolean} [params.includeDegraded=false]
 * @returns {Set<string>} matching ids
 */
export function filterRowsByTokenQuery({
                                         rows,
                                         query,
                                         includeStale = false,
                                         includeDegraded = false,
                                       }) {
  const list = Array.isArray(rows) ? rows : []
  const uniq = uniqueById(list)
  if (!query) {
    // Only filter by freshness toggles when no query provided
    const ids = new Set()
    const ONE_HOUR_MS = 60 * 60 * 1000
    const now = Date.now()
    for (const r of uniq) {
      const s = typeof r?.scannerAt === 'number' ? r.scannerAt : null
      const t = typeof r?.tickAt === 'number' ? r.tickAt : null
      const p = typeof r?.pairStatsAt === 'number' ? r.pairStatsAt : null
      const any = !!(s || t || p)
      const fresh = any && [s, t, p].some((v) => typeof v === 'number' && now - v < ONE_HOUR_MS)
      const state = any ? (fresh ? 'fresh' : 'stale') : 'degraded'
      if (
        state === 'fresh' ||
        (state === 'stale' && includeStale) ||
        (state === 'degraded' && includeDegraded)
      ) {
        ids.add(r.id)
      }
    }
    return ids
  }
  const q = String(query).toLowerCase()
  const safeIncludes = (s) =>
    String(s || '')
      .toLowerCase()
      .includes(q)
  const ids = new Set()
  const ONE_HOUR_MS = 60 * 60 * 1000
  const now = Date.now()
  for (const r of uniq) {
    const s = typeof r?.scannerAt === 'number' ? r.scannerAt : null
    const t = typeof r?.tickAt === 'number' ? r.tickAt : null
    const p = typeof r?.pairStatsAt === 'number' ? r.pairStatsAt : null
    const any = !!(s || t || p)
    const fresh = any && [s, t, p].some((v) => typeof v === 'number' && now - v < ONE_HOUR_MS)
    const state = any ? (fresh ? 'fresh' : 'stale') : 'degraded'
    if (
      !(
        state === 'fresh' ||
        (state === 'stale' && includeStale) ||
        (state === 'degraded' && includeDegraded)
      )
    )
      continue
    if (safeIncludes(r?.tokenName) || safeIncludes(r?.tokenSymbol)) ids.add(r.id)
  }
  return ids
}

/**
 * Deduplicate an array of objects by their 'id' property, keeping the first occurrence.
 * @template T extends { id: string }
 * @param {T[]} arr
 * @returns {T[]}
 */
export function uniqueById(arr) {
  const seen = new Set()
  return arr.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}
