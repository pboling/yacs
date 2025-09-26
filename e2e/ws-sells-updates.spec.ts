import { Page, test, expect } from '@playwright/test'

async function getFastRowIdAndCellText(
  page: Page,
  table: 'Trending Tokens' | 'New Tokens',
  nth: number,
): Promise<{ rowId: string; text: string }> {
  const heading = page.getByRole('heading', { name: table })
  await expect(heading).toBeVisible()
  const tableEl = heading.locator('..').locator('table.tokens')
  await expect(tableEl).toBeVisible()
  // Choose a row that is already fast-subscribed (Eye icon) to ensure prompt updates
  const row = tableEl.locator('tbody tr:has([aria-label="Subscribed (fast)"])').first()
  await expect(row).toBeVisible()
  const rowId = await row.getAttribute('data-row-id')
  expect(rowId).toBeTruthy()
  const cell = row.locator(`td:nth-child(${String(nth)})`)
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

// Deterministic validation: use the Buys/Sells counters which increment over time.
// We assert Sells increases for a specific row identified by its token-derived key.
// Column indices: 1 Token, 2 Exchange, 3 Price, 4 MCap, 5 Volume, 6 Chg, 7 Age, 8 Buys/Sells, 9 Liquidity.
function parseSells(text: string): number {
  const cleaned = text.replace(/\s+/g, '').replace(/,/g, '')
  const parts = cleaned.split('/')
  const sells = parts.length > 1 ? parts[1] : ''
  const n = Number(sells)
  return Number.isFinite(n) ? n : 0
}

// Trending table: Sells increases on the same row key
test('Trending Tokens: Sells increases via WebSocket (same row key)', async ({ page }) => {
  await page.goto('/')

  const { rowId, text } = await getFastRowIdAndCellText(page, 'Trending Tokens', 8)
  expect(text.length).toBeGreaterThan(0)

  // Warm-up: ensure the cell text changes at least once so we know updates are flowing for this row
  await expect
    .poll(async () => await getCellTextByRowId(page, 'Trending Tokens', rowId, 8), {
      timeout: 30_000,
      intervals: [100, 250, 500, 1000],
    })
    .not.toBe(text)

  // Refresh baseline after first observed change for a deterministic comparison
  const baseline = parseSells(await getCellTextByRowId(page, 'Trending Tokens', rowId, 8))

  await expect
    .poll(async () => parseSells(await getCellTextByRowId(page, 'Trending Tokens', rowId, 8)), {
      timeout: 30_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(baseline)
})

// New table: Sells increases on the same row key
test('New Tokens: Sells increases via WebSocket (same row key)', async ({ page }) => {
  await page.goto('/')

  const { rowId, text } = await getFastRowIdAndCellText(page, 'New Tokens', 8)
  expect(text.length).toBeGreaterThan(0)

  // Warm-up: ensure the cell text changes at least once so we know updates are flowing for this row
  await expect
    .poll(async () => await getCellTextByRowId(page, 'New Tokens', rowId, 8), {
      timeout: 30_000,
      intervals: [100, 250, 500, 1000],
    })
    .not.toBe(text)

  // Refresh baseline after first observed change for a deterministic comparison
  const baseline = parseSells(await getCellTextByRowId(page, 'New Tokens', rowId, 8))

  await expect
    .poll(async () => parseSells(await getCellTextByRowId(page, 'New Tokens', rowId, 8)), {
      timeout: 30_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(baseline)
})
