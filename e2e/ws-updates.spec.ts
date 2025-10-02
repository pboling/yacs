import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

type TableName = 'Trending Tokens' | 'New Tokens'
type Counter = 'buys' | 'sells'

// Find the table.tokens that logically belongs to the given section heading.
async function findTableForHeading(page: Page, tableName: string) {
  const heading = page.getByRole('heading', { name: tableName })
  await expect(heading).toBeVisible()
  // Look for the first table after the heading in document order whose class
  // contains 'tokens'. This is concise and robust across wrapper nesting.
  let tableEl = heading.locator('xpath=(following::table[contains(@class, "tokens")])[1]')
  if ((await tableEl.count()) === 0) {
    // Fallback: pick the first table.tokens on the page
    tableEl = page.locator('table.tokens').first()
  }
  return tableEl
}

async function getSubscribedRowIdAndCellText(
  page: Page,
  table: TableName,
  nth: number,
): Promise<{ rowId: string; text: string }> {
  const heading = page.getByRole('heading', { name: table })
  await expect(heading).toBeVisible()
  const tableEl = await findTableForHeading(page, table)
  await expect(tableEl).toBeVisible()
  // Find the Token column header using <thead> <th>
  const ths = tableEl.locator('thead tr th')
  const count = await ths.count()
  let tokenHeaderIdx = -1
  for (let i = 0; i < count; i++) {
    const thText = (await ths.nth(i).textContent())?.trim().toLowerCase()
    if (thText && thText.includes('token')) {
      tokenHeaderIdx = i
      break
    }
  }
  if (tokenHeaderIdx === -1) throw new Error('Token column header not found')
  const tokenHeader = ths.nth(tokenHeaderIdx)
  await expect(tokenHeader).toBeVisible()
  await tokenHeader.click()
  // Wait for table to re-render after sort
  await page.waitForTimeout(300)
  // Poll for row existence, not visibility
  let subRow = tableEl.locator(
    'tbody tr:has(td:nth-last-child(2) button[aria-label="click to pause data subscription for this token"])'
  ).first()
  await expect
    .poll(async () => await subRow.count(), { timeout: 5000, intervals: [100, 250, 500] })
    .toBeGreaterThan(0)
  const rowId = await subRow.getAttribute('data-row-id')
  expect(rowId).toBeTruthy()
  const cell = subRow.locator(`td:nth-child(${String(nth)})`)
  await expect(cell).toHaveCount(1)
  const raw = await cell.textContent()
  const text = (raw ?? '').trim()
  const rid = rowId ?? ''
  expect(rid.length).toBeGreaterThan(0)
  return { rowId: rid, text }
}

async function getCellTextByRowId(
  page: Page,
  table: TableName,
  rowId: string,
  nth: number,
): Promise<string> {
  const heading = page.getByRole('heading', { name: table })
  // Always locate the table that currently contains the rowId to avoid
  // race conditions with dynamic table instances.
  const tableEl = await findTableContainingRow(page, rowId)
  const row = tableEl.locator(`tbody tr[data-row-id="${rowId}"]`)
  // Ensure the row is scrolled into view inside the table's scroll container
  const container = tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
  await expect(container).toBeVisible()
  await container.evaluate((el: Element, rid: string) => {
    const c = el as HTMLElement
    const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`) as HTMLElement | null
    if (!rowEl) return
    const rowTop = rowEl.offsetTop
    c.scrollTop = Math.max(0, rowTop - 20)
  }, rowId)
  // Read the cell text via the container to avoid visibility/virtualization flakiness
  const raw = await container.evaluate((c: Element, args: { rid: string; idx: number }) => {
    const containerEl = c as HTMLElement
    const rowEl = containerEl.querySelector(`tbody tr[data-row-id="${args.rid}"]`)
    if (!rowEl) return ''
    const td = rowEl.querySelector(`td:nth-child(${args.idx})`) as HTMLElement | null
    return td ? td.textContent : ''
  }, { rid: rowId, idx: nth })
  return (raw ?? '').trim()
}

function parseCounter(text: string, kind: Counter): number {
  const matches = text.match(/\d[\d,]*/g)
  const nums: string[] = matches ? matches.slice() : []
  let pick: string | undefined
  if (kind === 'buys') pick = nums[0]
  else pick = nums.length >= 2 ? nums[1] : nums[nums.length - 1]
  if (!pick) return 0
  const n = Number(pick.replace(/,/g, ''))
  return isFinite(n) ? n : 0
}

async function forceResubscribe(page: Page, table: TableName) {
  const heading = page.getByRole('heading', { name: table })
  // Find the .table-wrap container by scanning matching tables and using the
  // container that contains the chosen table.
  const tableEl = await findTableForHeading(page, table)
  const container = tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
  // Tiny scroll jiggle to trigger onScrollStart/onScrollStop cycle
  await container.evaluate((el: Element) => {
    const c = el as HTMLElement
    c.scrollTop += 50
  })
  await page.waitForTimeout(50)
  await container.evaluate((el: Element) => {
    const c = el as HTMLElement
    c.scrollTop = 0
  })
  await page.waitForTimeout(50)
}

// Find the table element that contains a row with the given data-row-id.
async function findTableContainingRow(page: Page, rowId: string) {
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
    if (typeof idx === 'number' && idx >= 0) {
      return page.locator('table.tokens').nth(idx)
    }
    // small backoff before retry
    await page.waitForTimeout(200)
  }
  throw new Error(`table containing row ${rowId} not found after ${timeout}ms`)
}

async function forceResubscribeForRow(page: Page, table: TableName, rowId: string) {
  // Always resolve the table that contains the row at the time of action.
  const tableEl2 = await findTableContainingRow(page, rowId)
  const container = tableEl2.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
  const row = tableEl2.locator(`tbody tr[data-row-id="${rowId}"]`)
  await expect(container).toBeVisible()
  // Scroll to the row to ensure it is rendered in the virtualized viewport
  await container.evaluate((el: Element, rid: string) => {
    const c = el as HTMLElement
    const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`) as HTMLElement | null
    if (!rowEl) return
    const rowTop = rowEl.offsetTop
    c.scrollTop = Math.max(0, rowTop - 20)
  }, rowId)
  // Pause briefly to allow rendering
  await page.waitForTimeout(150)
  // Simulate scrolling away and back to trigger resubscribe behavior
  await container.evaluate((el: Element, rid: string) => {
    const c = el as HTMLElement
    const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`) as HTMLElement | null
    if (!rowEl) return
    const rowTop = rowEl.offsetTop
    c.scrollTop = Math.max(0, rowTop + c.clientHeight)
  }, rowId)
  await page.waitForTimeout(100)
  // Scroll back to rowTop to reveal again
  await container.evaluate((el: Element, rid: string) => {
    const c = el as HTMLElement
    const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`) as HTMLElement | null
    if (!rowEl) return
    const rowTop = rowEl.offsetTop
    c.scrollTop = Math.max(0, rowTop - 20)
  }, rowId)
  await page.waitForTimeout(100)
}

async function openDetailsForRow(page: Page, table: TableName, rowId: string) {
  const tableEl = await findTableContainingRow(page, rowId)
  const container = tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]')
  await expect(container).toBeVisible()
  await container.evaluate((el: Element, rid: string) => {
    const c = el as HTMLElement
    const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`) as HTMLElement | null
    if (!rowEl) return
    const rowTop = rowEl.offsetTop
    c.scrollTop = Math.max(0, rowTop - 20)
  }, rowId)
  // Click the row's details button via the DOM to avoid visibility flakiness
  await container.evaluate((el: Element, rid: string) => {
    const c = el as HTMLElement
    const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`)
    if (!rowEl) return
    // Try aria-label then title
    const btn = rowEl.querySelector('button[aria-label^="Open details"]') || rowEl.querySelector('button[title^="Open details"]') || rowEl.querySelector('button')
    if (btn) (btn as HTMLElement).click()
  }, rowId)
  // brief wait for lock/subscriptions to apply
  await page.waitForTimeout(50)
}

const cases: { table: TableName; kind: Counter }[] = [
  { table: 'Trending Tokens', kind: 'buys' },
  { table: 'New Tokens', kind: 'buys' },
  { table: 'Trending Tokens', kind: 'sells' },
  { table: 'New Tokens', kind: 'sells' },
]

for (const { table, kind } of cases) {
  test(`${table}: ${kind.toUpperCase()} increases via WebSocket (same row key)`, async ({
    page,
  }) => {
    await page.goto('/')

    // Select a subscribed row and get its id
    const { rowId } = await getSubscribedRowIdAndCellText(page, table, 8)

    // Ensure subscriptions are (re)sent after socket is ready and target row is focused
    await forceResubscribe(page, table)
    await forceResubscribeForRow(page, table, rowId)
    // Accelerate updates deterministically with modal/x5 subscription
    await openDetailsForRow(page, table, rowId)

    // Baseline
    const initial = parseCounter(await getCellTextByRowId(page, table, rowId, 8), kind)

    // Expect numeric increase
    await expect
      .poll(async () => parseCounter(await getCellTextByRowId(page, table, rowId, 8), kind), {
        timeout: 30_000,
        intervals: [100, 250, 500, 1000],
      })
      .toBeGreaterThan(initial)

    // And keep increasing
    const next = parseCounter(await getCellTextByRowId(page, table, rowId, 8), kind)
    await expect
      .poll(async () => parseCounter(await getCellTextByRowId(page, table, rowId, 8), kind), {
        timeout: 30_000,
        intervals: [100, 250, 500, 1000],
      })
      .toBeGreaterThan(next)
  })
}
