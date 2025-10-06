import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

export type Counter = 'buys' | 'sells'

export function toUInt32(n: any) {
  const x = Number(n)
  if (!Number.isFinite(x)) return undefined
  return x >>> 0
}

export function getBaseSeed() {
  const env = process?.env ?? {}
  const fromEnv = env.VITE_SEED ?? env.SEED
  const parsedEnv = toUInt32(fromEnv)
  if (parsedEnv !== undefined) return parsedEnv
  try {
    const p = path.resolve(process.cwd(), '.seed')
    const txt = fs.readFileSync(p, 'utf8')
    const m = txt.match(/-?\d+/)
    if (m) {
      const parsed = toUInt32(m[0])
      if (parsed !== undefined) return parsed
    }
  } catch {
    /* ignore */
  }
  const DEFAULT_SEED = 0xc0ffee
  return DEFAULT_SEED >>> 0
}

// Small deterministic PRNG matching server logic
export function mulberry32(seed: number) {
  let t = seed >>> 0
  return function () {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function loadSymbolsFromYaml(): string[] {
  const yamlPath = path.resolve(process.cwd(), 'src/config/symbols.yaml')
  const text = fs.readFileSync(yamlPath, 'utf-8')
  const lines = text.split(/\r?\n/)
  const items: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('- ')) {
      let v = line.slice(2).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (v) items.push(v)
    }
  }
  // Expand 5-letter words with suffixes like the app
  const allAlpha = items.every((w) => /^[A-Za-z]+$/.test(w))
  const allFive = allAlpha && items.every((w) => w.length === 5)
  if (allFive && items.length > 0) {
    const expanded: string[] = []
    const target = Math.max(2000, 2500)
    for (let i = 1; i <= target; i++) {
      const word = items[(i - 1) % items.length]
      expanded.push(`${word}${String(i).padStart(4, '0')}`)
    }
    return expanded
  }
  return items
}

export function generateDeterministicTokens(n: number): string[] {
  const seed = getBaseSeed()
  const rnd = mulberry32(seed)
  const symbols = loadSymbolsFromYaml()
  const result: string[] = []
  const used = new Set<string>()
  while (result.length < n && used.size < symbols.length) {
    const idx = Math.floor(rnd() * symbols.length)
    const t = symbols[idx]
    if (!used.has(t)) {
      used.add(t)
      result.push(t)
    }
  }
  return result
}

// Helpers for interacting with the virtualized table
export async function findTableForHeading(page: Page, tableName: string) {
  const heading = page.getByRole('heading', { name: tableName })
  await expect(heading).toBeVisible()
  let tableEl = heading.locator('xpath=(following::table[contains(@class, "tokens")])[1]')
  if ((await tableEl.count()) === 0) tableEl = page.locator('table.tokens').first()
  return tableEl
}

export async function getRowIdsForTokens(page: Page, tableName: string, tokenList: string[]) {
  const tableEl = await findTableForHeading(page, tableName)
  await expect(tableEl).toBeVisible()
  const container = tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
  await expect(container).toBeVisible()
  // Robustly wait for at least one row to be present in the table
  const rowLocator = tableEl.locator('tbody tr')
  let rowAppeared = false
  const rowTimeout = 15000
  const rowStart = Date.now()
  while (Date.now() - rowStart < rowTimeout) {
    if (await rowLocator.count() > 0) {
      rowAppeared = true
      break
    }
    await page.waitForTimeout(200)
  }
  if (!rowAppeared) {
    // Diagnostic logging
    const tableHtml = await tableEl.evaluate(el => el.outerHTML)
    const containerHtml = await container.evaluate(el => el.outerHTML)
    throw new Error(`No rows appeared in table '${tableName}' after ${rowTimeout}ms. Table HTML: ${tableHtml}\nContainer HTML: ${containerHtml}`)
  }
  const lowerSet = new Set(tokenList.map(t => t.toLowerCase()))
  const found: { rowId: string; token: string }[] = []
  const seen = new Set<string>()
  const containerHandleForMetrics = await container.elementHandle()
  const metrics = containerHandleForMetrics
    ? await page.evaluate((el: Element) => { const c = el as HTMLElement; return { scrollHeight: c.scrollHeight, clientHeight: c.clientHeight } }, containerHandleForMetrics)
    : { scrollHeight: 0, clientHeight: 0 }
  try { if (containerHandleForMetrics) await containerHandleForMetrics.dispose() } catch {}
  const step = Math.max(100, Math.floor(metrics.clientHeight * 0.8))
  let scrollTop = 0
  const maxSteps = Math.ceil(metrics.scrollHeight / step) + 5
  for (let i = 0; i < maxSteps; i++) {
    const containerHandle = await container.elementHandle()
    let rowsData: { rid: string | null; token: string }[] = []
    if (containerHandle) {
      rowsData = await page.evaluate((el: Element) => {
        const table = (el as Element).querySelector('table.tokens') as HTMLTableElement | null
        if (!table) return []
        return Array.from(table.querySelectorAll('tbody tr')).map(tr => {
          const rid = tr.getAttribute('data-row-id')
          const td = tr.querySelector('td')
          const raw = td ? (td.textContent || '').trim() : ''
          let token = ''
          if (raw) {
            const m = raw.match(/[A-Za-z0-9-]+/)
            token = m ? m[0] : raw
          }
          return { rid, token }
        })
      }, containerHandle)
      try { await containerHandle.dispose() } catch {}
    }

    for (const item of rowsData) {
      const rid = item.rid
      if (!rid || seen.has(rid)) continue
      const token = (item.token ?? '').trim()
      const tl = token.toLowerCase()
      for (const s of lowerSet) {
        if (!s) continue
        if (tl.includes(s) || s.includes(tl)) { found.push({ rowId: rid, token }); break }
      }
      seen.add(rid)
    }
    if (found.length >= lowerSet.size) break
    const handleForScroll = await container.elementHandle()
    if (handleForScroll) {
      try { await handleForScroll.evaluate((el: HTMLElement, top: number) => { el.scrollTop = top }, scrollTop) } catch {}
      try { await handleForScroll.dispose() } catch {}
    }
    await page.waitForTimeout(50)
    scrollTop += step
    if (scrollTop > metrics.scrollHeight) break
  }
  return found
}

export async function getCellTextByToken(page: Page, tableName: string, token: string, nth: number): Promise<string> {
  const tableEl = await findTableForHeading(page, tableName)
  await expect(tableEl).toBeVisible()
  const container = tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
  await expect(container).toBeVisible()
  const containerHandleForMetrics = await container.elementHandle()
  const metrics = containerHandleForMetrics
    ? await containerHandleForMetrics.evaluate((el: HTMLElement) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    : { scrollHeight: 0, clientHeight: 0 }
  try { if (containerHandleForMetrics) await containerHandleForMetrics.dispose() } catch {}
  const step = Math.max(100, Math.floor(metrics.clientHeight * 0.8))
  let scrollTop = 0
  const maxSteps = Math.ceil(metrics.scrollHeight / step) + 5
  const wanted = token.trim().toLowerCase()

  for (let i = 0; i < maxSteps; i++) {
    const containerHandle = await container.elementHandle()
    if (!containerHandle) break
    const val = await containerHandle.evaluate((el: Element, args: { wanted: string; idx: number }) => {
      const table = (el as Element).querySelector('table.tokens') as HTMLTableElement | null
      if (!table) return null
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      for (const tr of rows) {
        const td = tr.querySelector('td')
        if (!td) continue
        const raw = (td.textContent || '').trim()
        const m = raw.match(/[A-Za-z0-9-]+/)
        const tokenText = m ? m[0] : raw
        const low = tokenText.toLowerCase()
        if (!low) continue
        if (low.includes(args.wanted) || args.wanted.includes(low)) {
          try { (el as HTMLElement).scrollTop = Math.max(0, (tr as HTMLElement).offsetTop - 20) } catch {}
          const cell = tr.querySelector(`td:nth-child(${args.idx})`)
          return cell ? (cell.textContent || '').trim() : ''
        }
      }
      return null
    }, { wanted, idx: nth })
    try { await containerHandle.dispose() } catch {}
    if (val !== null) return String(val)
    const handleForScroll = await container.elementHandle()
    if (handleForScroll) {
      try { await handleForScroll.evaluate((el: HTMLElement, top: number) => { el.scrollTop = top }, scrollTop) } catch {}
      try { await handleForScroll.dispose() } catch {}
    }
    await page.waitForTimeout(60)
    scrollTop += step
    if (scrollTop > metrics.scrollHeight) break
  }
  return ''
}

export async function scrollRowIntoViewByToken(page: Page, tableName: string, token: string): Promise<boolean> {
  const tableEl = await findTableForHeading(page, tableName)
  await expect(tableEl).toBeVisible()
  const container = tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
  await expect(container).toBeVisible()
  const wanted = token.trim().toLowerCase()
  try {
    const matched = await container.evaluate((el: Element, args: { wanted: string }) => {
      const table = (el as Element).querySelector('table.tokens') as HTMLTableElement | null
      if (!table) return false
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      for (const tr of rows) {
        const td = tr.querySelector('td')
        if (!td) continue
        const raw = (td.textContent || '').trim()
        const m = raw.match(/[A-Za-z0-9-]+/)
        const tokenText = m ? m[0] : raw
        if (!tokenText) continue
        const low = tokenText.toLowerCase()
        if (low.includes(args.wanted) || args.wanted.includes(low)) {
          try { (el as HTMLElement).scrollTop = Math.max(0, (tr as HTMLElement).offsetTop - 20) } catch {}
          return true
        }
      }
      return false
    }, { wanted })
    return Boolean(matched)
  } catch (err) {
    const e: any = err
    console.log('scrollRowIntoViewByToken error:', e && e.stack ? e.stack : e)
    return false
  }
}

export async function clickDetailsByToken(page: Page, tableName: string, token: string): Promise<boolean> {
  const tableEl = await findTableForHeading(page, tableName)
  await expect(tableEl).toBeVisible()
  const container = tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
  await expect(container).toBeVisible()
  const wanted = token.trim().toLowerCase()
  try {
    const clicked = await container.evaluate((el: Element, args: { wanted: string }) => {
      const table = (el as Element).querySelector('table.tokens') as HTMLTableElement | null
      if (!table) return false
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      for (const tr of rows) {
        const td = tr.querySelector('td')
        if (!td) continue
        const raw = (td.textContent || '').trim()
        const m = raw.match(/[A-Za-z0-9-]+/)
        const tokenText = m ? m[0] : raw
        if (!tokenText) continue
        const low = tokenText.toLowerCase()
        if (low.includes(args.wanted) || args.wanted.includes(low)) {
          const btn = tr.querySelector('button[aria-label^="Open details"]') || tr.querySelector('button[title^="Open details"]') || tr.querySelector('button')
          if (btn) {
            try { (btn as HTMLElement).click() } catch {}
            return true
          }
        }
      }
      return false
    }, { wanted })
    return Boolean(clicked)
  } catch (err) {
    const e: any = err
    console.log('clickDetailsByToken error:', e && e.stack ? e.stack : e)
    return false
  }
}

export async function clickDetailsByRowId(page: Page, rowId: string): Promise<boolean> {
  try {
    const clicked = await page.evaluate((rid: string) => {
      const el = document.querySelector(`tr[data-row-id="${rid}"]`)
      if (!el) return false
      try { (el as HTMLElement).scrollIntoView({ block: 'center' }) } catch {}
      const btn = el.querySelector('button[aria-label^="Open details"]') || el.querySelector('button[title^="Open details"]') || el.querySelector('button')
      if (btn) {
        try { (btn as HTMLElement).click() } catch {}
        return true
      }
      return false
    }, rowId)
    return Boolean(clicked)
  } catch (err) {
    const e: any = err
    console.log('clickDetailsByRowId error:', e && e.stack ? e.stack : e)
    return false
  }
}

export function parseCounter(text: string, kind: Counter): number {
  const matches = text.match(/\d[\d,]*/g)
  const nums: string[] = matches ? matches.slice() : []
  let pick: string | undefined
  if (kind === 'buys') pick = nums[0]
  else pick = nums.length >= 2 ? nums[1] : nums[nums.length - 1]
  if (!pick) return 0
  const n = Number(pick.replace(/,/g, ''))
  return isFinite(n) ? n : 0
}

export async function findTableContainingRow(page: Page, rowId: string) {
  const timeout = 15_000
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const idx = await page.evaluate((rid: string) => {
      const tables = Array.from(document.querySelectorAll('table.tokens'))
      for (let i = 0; i < tables.length; i++) {
        if (tables[i].querySelector(`tbody tr[data-row-id="${rid}"]`)) return i
      }
      return -1
    }, rowId)
    if (idx >= 0) return page.locator('table.tokens').nth(idx)
    await page.waitForTimeout(200)
  }
  const availableRowIds = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table.tokens'))
    return tables.map(table => Array.from(table.querySelectorAll('tbody tr[data-row-id]')).map(tr => tr.getAttribute('data-row-id')))
  })
  throw new Error(`table containing row ${rowId} not found after ${timeout}ms. Available rowIds: ${JSON.stringify(availableRowIds)}`)
}

export async function openDetailsByRowIdRobust(page: Page, rowId: string): Promise<boolean> {
  try {
    const tableEl = await findTableContainingRow(page, rowId)
    const container = tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
    await expect(container).toBeVisible()
    // Scroll the container to the row offset and click the button inside it
    const clicked = await container.evaluate((el: Element, rid: string) => {
      const c = el as HTMLElement
      const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`) as HTMLElement | null
      if (!rowEl) return false
      try { c.scrollTop = Math.max(0, rowEl.offsetTop - 20) } catch {}
      const btn = rowEl.querySelector('button[aria-label^="Open details"]') || rowEl.querySelector('button[title^="Open details"]') || rowEl.querySelector('button')
      if (btn) {
        try { (btn as HTMLElement).click() } catch {}
        return true
      }
      return false
    }, rowId)
    await page.waitForTimeout(50)
    return Boolean(clicked)
  } catch (err) {
    const e: any = err
    console.log('openDetailsByRowIdRobust error:', e && e.stack ? e.stack : e)
    return false
  }
}
