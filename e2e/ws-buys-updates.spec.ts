import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function getFastRowIdAndCellText(
  page: Page,
  table: 'Trending Tokens' | 'New Tokens',
  nth: number,
): Promise<{ rowId: string; text: string }> {
  const heading = page.getByRole('heading', { name: table })
  await expect(heading).toBeVisible()
  const tableEl = heading.locator('..').locator('table.tokens')
  await expect(tableEl).toBeVisible()
  // Prefer a row that is fast-subscribed (Eye icon) to ensure timely WS updates
  const fastRow = tableEl.locator('tbody tr:has([aria-label="Subscribed (fast)"])').first()
  await expect(fastRow).toBeVisible()
  const rowId = await fastRow.getAttribute('data-row-id')
  expect(rowId).toBeTruthy()
  const cell = fastRow.locator(`td:nth-child(${String(nth)})`)
  await expect(cell).toBeVisible()
  const text = (await cell.textContent())?.trim() ?? ''
  const rid = rowId ?? ''
  expect(rid.length).toBeGreaterThan(0)
  return { rowId: rid, text }
}

async function getCellTextByRowId(
  page: Page,
  table: 'Trending Tokens' | 'New Tokens',
  rowId: string,
  nth: number,
): Promise<string> {
  const heading = page.getByRole('heading', { name: table })
  const tableEl = heading.locator('..').locator('table.tokens')
  const row = tableEl.locator(`tbody tr[data-row-id="${rowId}"]`)
  await expect(row).toBeVisible()
  const cell = row.locator(`td:nth-child(${String(nth)})`)
  await expect(cell).toBeVisible()
  return (await cell.textContent())?.trim() ?? ''
}

// Deterministic: validate Buys increases for a specific row identified by its token-derived key (data-row-id).
// Column indices (1-based): 1 Token, 2 Exchange, 3 Price, 4 MCap, 5 Volume, 6 Chg, 7 Age, 8 Buys/Sells, 9 Liquidity.
function parseBuys(text: string): number {
  // Extract the first integer-like number from the cell (handles formats like "B:123\nS:456" or "123 / 456")
  const nums = (text || '').match(/\d[\d,]*/g) || []
  if (nums.length === 0) return 0
  const n = Number(nums[0].replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

test('Trending Tokens: Buys increases via WebSocket (same row key)', async ({ page }) => {
  await page.goto('/')

  // Pick a row that is confirmed fast-subscribed to ensure timely updates
  const { rowId } = await getFastRowIdAndCellText(page, 'Trending Tokens', 8)
  // Establish a numeric baseline
  const initial = parseBuys(await getCellTextByRowId(page, 'Trending Tokens', rowId, 8))

  // Wait until buys increases beyond the baseline (numeric), regardless of text formatting
  await expect
    .poll(async () => parseBuys(await getCellTextByRowId(page, 'Trending Tokens', rowId, 8)), {
      timeout: 30_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(initial)

  // And keep drifting upwards deterministically
  const next = parseBuys(await getCellTextByRowId(page, 'Trending Tokens', rowId, 8))
  await expect
    .poll(async () => parseBuys(await getCellTextByRowId(page, 'Trending Tokens', rowId, 8)), {
      timeout: 30_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(next)
})

test('New Tokens: Buys increases via WebSocket (same row key)', async ({ page }) => {
  await page.goto('/')

  const { rowId } = await getFastRowIdAndCellText(page, 'New Tokens', 8)
  const initial = parseBuys(await getCellTextByRowId(page, 'New Tokens', rowId, 8))

  await expect
    .poll(async () => parseBuys(await getCellTextByRowId(page, 'New Tokens', rowId, 8)), {
      timeout: 30_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(initial)

  const nxt = parseBuys(await getCellTextByRowId(page, 'New Tokens', rowId, 8))
  await expect
    .poll(async () => parseBuys(await getCellTextByRowId(page, 'New Tokens', rowId, 8)), {
      timeout: 30_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(nxt)
})
