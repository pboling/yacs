import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

type TableName = 'Trending Tokens' | 'New Tokens'
type Counter = 'buys' | 'sells'

async function getSubscribedRowIdAndCellText(
  page: Page,
  table: TableName,
  nth: number,
): Promise<{ rowId: string; text: string }> {
  const heading = page.getByRole('heading', { name: table })
  await expect(heading).toBeVisible()
  const tableEl = heading.locator('..').locator('table.tokens')
  await expect(tableEl).toBeVisible()
  // Prefer a row that is currently subscribed (Eye icon) to ensure timely WS updates
  const subRow = tableEl.locator('tbody tr:has([aria-label="Subscribed"])').first()
  await expect(subRow).toBeVisible()
  const rowId = await subRow.getAttribute('data-row-id')
  expect(rowId).toBeTruthy()
  const cell = subRow.locator(`td:nth-child(${String(nth)})`)
  await expect(cell).toBeVisible()
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
  const tableEl = heading.locator('..').locator('table.tokens')
  const row = tableEl.locator(`tbody tr[data-row-id="${rowId}"]`)
  await expect(row).toBeVisible()
  const cell = row.locator(`td:nth-child(${String(nth)})`)
  await expect(cell).toBeVisible()
  const raw = await cell.textContent()
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
  const container = heading.locator('..').locator('.table-wrap')
  await expect(container).toBeVisible()
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

async function forceResubscribeForRow(page: Page, table: TableName, rowId: string) {
  const heading = page.getByRole('heading', { name: table })
  const container = heading.locator('..').locator('.table-wrap')
  const row = heading.locator('..').locator(`table.tokens tbody tr[data-row-id="${rowId}"]`)
  await expect(container).toBeVisible()
  await expect(row).toBeVisible()
  // Scroll so the row is out of view
  await container.evaluate((el: Element, rid: string) => {
    const c = el as HTMLElement
    const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`)
    if (!rowEl) return
    const rowTop: number = rowEl.offsetTop
    // Scroll just past the row to hide it
    c.scrollTop = Math.max(0, rowTop + c.clientHeight)
  }, rowId)
  await page.waitForTimeout(100)
  // Scroll back to rowTop to reveal again
  await container.evaluate((el: Element, rid: string) => {
    const c = el as HTMLElement
    const rowEl = c.querySelector(`tbody tr[data-row-id="${rid}"]`)
    if (!rowEl) return
    const rowTop: number = rowEl.offsetTop
    c.scrollTop = Math.max(0, rowTop - 20)
  }, rowId)
  await page.waitForTimeout(100)
}

async function openDetailsForRow(page: Page, table: TableName, rowId: string) {
  const heading = page.getByRole('heading', { name: table })
  const row = heading.locator('..').locator(`table.tokens tbody tr[data-row-id="${rowId}"]`)
  await expect(row).toBeVisible()
  const btn = row.getByRole('button', { name: 'Open details' })
  await expect(btn).toBeVisible()
  await btn.click()
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
