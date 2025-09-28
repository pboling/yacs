// filepath: /home/pboling/WebstormProjects/dexcelerate-fe-test/e2e/detail-modal-compare.spec.ts
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

type TableName = 'Trending Tokens' | 'New Tokens'

async function firstSubscribedRowId(page: Page, table: TableName): Promise<string> {
  const heading = page.getByRole('heading', { name: table })
  await expect(heading).toBeVisible()
  const tableEl = heading.locator('..').locator('table.tokens')
  await expect(tableEl).toBeVisible()
  const subscribedRow = tableEl.locator('tbody tr:has([aria-label="Subscribed"])').first()
  await expect(subscribedRow).toBeVisible()
  const rowId = (await subscribedRow.getAttribute('data-row-id')) ?? ''
  expect(rowId.length).toBeGreaterThan(0)
  return rowId
}

async function openDetails(page: Page, table: TableName, rowId: string) {
  const heading = page.getByRole('heading', { name: table })
  const row = heading.locator('..').locator(`table.tokens tbody tr[data-row-id="${rowId}"]`)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Open details' }).click()
}

async function pickCompareToken(page: Page) {
  // Focus the compare input and click the first option in the dropdown list
  const input = page.getByPlaceholder('Search token name or symbol')
  await input.click()
  // Wait for options to render (we expect at least one)
  const optionsContainer = input
    .locator('xpath=following::div[contains(@style, "max-height: 260px")]')
    .first()
  await expect(optionsContainer).toBeVisible()
  // Click the first option (the list excludes the base token by construction)
  const firstOption = optionsContainer.locator('> div').first()
  await expect(firstOption).toBeVisible()
  await firstOption.click()
}

function parseRate(text: string): number {
  // Extract the number before ' upd/s'
  const m = /([0-9]+(?:\.[0-9]+)?)\s*upd\/s/i.exec(text)
  const v = m ? Number(m[1]) : NaN
  return Number.isFinite(v) ? v : 0
}

test.describe('DetailModal compare streaming', () => {
  test('Compare rate becomes > 0 and chart leaves Subscribing state', async ({ page }) => {
    await page.goto('/')

    // Use a subscribed row for determinism, then open details
    const rowId = await firstSubscribedRowId(page, 'Trending Tokens')
    await openDetails(page, 'Trending Tokens', rowId)

    // Base chart should quickly leave the empty state
    await expect(page.getByText('Collecting base data…')).toBeHidden({ timeout: 30_000 })

    // Select a compare token
    await pickCompareToken(page)

    // 1) The top bar should show a Compare rate that rises above 0.00 within a short time window
    const compareRateContainer = page.locator('text=Compare rate').locator('xpath=..')
    await expect(compareRateContainer).toBeVisible()
    await expect
      .poll(
        async () => {
          const text = (await compareRateContainer.textContent()) ?? ''
          return parseRate(text)
        },
        { timeout: 30_000, intervals: [200, 500, 1000] },
      )
      .toBeGreaterThan(0)

    // 2) The compare ChartSection title should no longer include "(Subscribing…)"
    await expect(page.getByText('(Subscribing…)')).toBeHidden({ timeout: 30_000 })

    // 3) Differential section should appear once compare is chosen
    const diff = page.getByText('Differential (Base vs Compare)')
    await expect(diff).toBeVisible()
  })

  test('Compare last update timestamp appears ("updated Ns ago")', async ({ page }) => {
    await page.goto('/')

    const rowId = await firstSubscribedRowId(page, 'New Tokens')
    await openDetails(page, 'New Tokens', rowId)

    await pickCompareToken(page)

    // Wait for the last update indicator to show up for compare token
    await expect(page.getByText(/updated\s+\d+s\s+ago/i)).toBeVisible({ timeout: 30_000 })
  })
})
