// filepath: /home/pboling/WebstormProjects/dexcelerate-fe-test/e2e/detail-modal-compare.spec.ts
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

type TableName = 'Trending Tokens' | 'New Tokens'

// Find the table.tokens that logically belongs to the given section heading.
async function findTableForHeading(page: Page, tableName: string) {
  const tables = page.locator('table.tokens')
  const count = await tables.count()
  for (let i = 0; i < count; i++) {
    const table = tables.nth(i)
    const ok = await table.evaluate((tbl: Element, name: string) => {
      function findPrevHeading(node: Element | null): string | null {
        if (!node) return null
        let sib = node.previousElementSibling
        while (sib) {
          // direct heading sibling
          if (/^H[1-6]$/.test(sib.tagName)) return (sib.textContent || '').trim()
          // check for nested heading inside wrapper
          const h = sib.querySelector('h1,h2,h3,h4,h5,h6')
          if (h) return (h.textContent || '').trim()
          sib = sib.previousElementSibling
        }
        // move up and repeat
        return node.parentElement ? findPrevHeading(node.parentElement) : null
      }
      const headingText = findPrevHeading(tbl)
      if (!headingText) return false
      // compare start of headingText with provided name (heading contains count)
      return headingText.trim().toLowerCase().startsWith(name.toLowerCase())
    }, tableName)
    if (ok) return table
  }
  throw new Error(`table.tokens for heading "${tableName}" not found`)
}

async function firstSubscribedRowId(page: Page, table: TableName): Promise<string> {
  const heading = page.getByRole('heading', { name: table })
  await expect(heading).toBeVisible()
  // Find the table.tokens logically associated with this heading.
  const tableEl = await findTableForHeading(page, table)
  await expect(tableEl).toBeVisible()
  const subscribedRow = tableEl.locator('tbody tr[data-row-state="subscribed"]').first()
  await expect(subscribedRow).toBeVisible()
  const rowId = (await subscribedRow.getAttribute('data-row-id')) ?? ''
  expect(rowId.length).toBeGreaterThan(0)
  return rowId
}

async function openDetails(page: Page, table: TableName, rowId: string) {
  const tableEl = await findTableForHeading(page, table)
  const row = tableEl.locator(`tbody tr[data-row-id="${rowId}"]`)
  await expect(row).toBeVisible()
  await row.getByTestId(`open-details-#1`).click()
}

async function pickCompareToken(page: Page) {
  // Focus the compare input and click the first option in the dropdown list
  const input = page.getByTestId('compare-input')
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
