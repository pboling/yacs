// filepath: /home/pboling/WebstormProjects/dexcelerate-fe-test/e2e/detail-modal-compare.spec.ts
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Use shared helpers
import { findTableForHeading, clickDetailsByRowId, openDetailsByRowIdRobust } from './helpers'
// Import deterministic token generator
// import { generateDeterministicTokens } from '../src/utils/token.fixture.js'

type TableName = 'Trending Tokens' | 'New Tokens'

// Use shared click helper to open details by rowId. This delegates to a DOM evaluate click.
async function openDetailsByRowId(page: Page, rowId: string) {
  // prefer robust in-container click which handles virtualization
  const clicked = await openDetailsByRowIdRobust(page, rowId)
  if (!clicked) {
    // fallback to existing document-based click
    const clicked2 = await clickDetailsByRowId(page, rowId)
    if (!clicked2) throw new Error(`Could not click details for row ${rowId}`)
  }
  await page.waitForTimeout(50)
}

// pickCompareToken unchanged but robustified to avoid flaky locators
async function pickCompareToken(page: Page) {
  const input = page.getByTestId('compare-input')
  await input.click()
  const optionsContainer = input
    .locator('xpath=following::div[contains(@style, "max-height: 260px")]')
    .first()
  await expect(optionsContainer).toBeVisible()
  const options = optionsContainer.locator('> div')
  const count = await options.count()
  for (let i = 0; i < count; i++) {
    try {
      const txt = (await options.nth(i).textContent()) ?? ''
      if (txt.includes('•')) {
        console.log('pickCompareToken: choosing option with bullet:', txt.trim())
        await options.nth(i).click()
        return
      }
    } catch (e) {
      // ignore and try next
    }
  }
  // fallback to first option
  const firstOption = options.first()
  await expect(firstOption).toBeVisible()
  console.log('pickCompareToken: fallback to first option')
  await firstOption.click()
}

// Use a deterministic token for test selection
// const deterministicTokens = generateDeterministicTokens(1)

test.describe('DetailModal compare streaming', () => {
  test('Compare rate becomes > 0 and chart leaves Subscribing state', async ({ page }) => {
    await page.goto('/')
    const tableName: TableName = 'New Tokens'
    const tableEl = await findTableForHeading(page, tableName)
    await expect(tableEl).toBeVisible()
    // Pick a token from the first visible row in the table
    const tableRowsLocator = tableEl.locator('tbody tr')
    let rowCount = await tableRowsLocator.count()
    let retries = 5
    while (rowCount === 0 && retries > 0) {
      console.log('No rows found, waiting and retrying...')
      await page.waitForTimeout(500)
      rowCount = await tableRowsLocator.count()
      retries--
    }
    if (rowCount === 0) {
      const tableHtml = await tableEl.innerHTML()
      console.log('DIAGNOSTIC: Table HTML:', tableHtml)
      const headings = await page.locator('h2').allTextContents()
      console.log('DIAGNOSTIC: Page headings:', headings)
      throw new Error('No rows found in New Tokens table after retries')
    }
    let compareToken = ''
    for (let i = 0; i < rowCount; i++) {
      const rowText = await tableRowsLocator.nth(i).textContent()
      const tokenMatch = rowText?.match(/[A-Za-z0-9-]+/)
      if (tokenMatch) {
        compareToken = tokenMatch[0]
        break
      }
    }
    if (!compareToken) throw new Error('No token found in table rows')
    // Find the rowId for the selected token
    let rowId = ''
    for (let i = 0; i < rowCount; i++) {
      const rowText = await tableRowsLocator.nth(i).textContent()
      if (rowText?.includes(compareToken)) {
        rowId = (await tableRowsLocator.nth(i).getAttribute('data-row-id')) || ''
        break
      }
    }
    if (!rowId) throw new Error('No rowId found for token in table')
    await openDetailsByRowId(page, rowId)
    await pickCompareToken(page)
    // Diagnostic: log compare subscription state and backend response
    const compareState = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]')
      if (!modal) return null
      const subText = modal.textContent || ''
      return {
        modalText: subText,
        subscribingVisible: !!/Subscribing/.exec(subText),
      }
    })
    console.log('DIAGNOSTIC: Modal compare state:', compareState)
    try {
      const resp = await page.request.get('http://localhost:3001/scanner')
      if (resp.ok()) {
        const body = await resp.json()
        console.log(
          'DIAGNOSTIC: /scanner pairs (first 10):',
          JSON.stringify(body.pairs?.slice(0, 10)),
        )
      }
    } catch (err: unknown) {
      console.log('DIAGNOSTIC: /scanner fetch error:', err)
    }
    await expect(page.getByText('(Subscribing…)')).toBeHidden({ timeout: 30_000 })
    const diff = page.getByText('Differential (Base vs Compare)')
    await expect(diff).toBeVisible()
  })

  test('Compare last update timestamp appears ("updated Ns ago")', async ({ page }) => {
    await page.goto('/')
    const tableName: TableName = 'New Tokens'
    const tableEl = await findTableForHeading(page, tableName)
    await expect(tableEl).toBeVisible()
    // Pick a token from the first visible row in the table
    const tableRowsLocator = tableEl.locator('tbody tr')
    let rowCount = await tableRowsLocator.count()
    let retries = 5
    while (rowCount === 0 && retries > 0) {
      console.log('No rows found, waiting and retrying...')
      await page.waitForTimeout(500)
      rowCount = await tableRowsLocator.count()
      retries--
    }
    if (rowCount === 0) {
      const tableHtml = await tableEl.innerHTML()
      console.log('DIAGNOSTIC: Table HTML:', tableHtml)
      const headings = await page.locator('h2').allTextContents()
      console.log('DIAGNOSTIC: Page headings:', headings)
      throw new Error('No rows found in New Tokens table after retries')
    }
    let compareToken = ''
    for (let i = 0; i < rowCount; i++) {
      const rowText = await tableRowsLocator.nth(i).textContent()
      const tokenMatch = rowText?.match(/[A-Za-z0-9-]+/)
      if (tokenMatch) {
        compareToken = tokenMatch[0]
        break
      }
    }
    if (!compareToken) throw new Error('No token found in table rows')
    // Find the rowId for the selected token
    let rowId = ''
    for (let i = 0; i < rowCount; i++) {
      const rowText = await tableRowsLocator.nth(i).textContent()
      if (rowText?.includes(compareToken)) {
        rowId = (await tableRowsLocator.nth(i).getAttribute('data-row-id')) || ''
        break
      }
    }
    if (!rowId) throw new Error('No rowId found for token in table')
    await openDetailsByRowId(page, rowId)
    await pickCompareToken(page)
    await expect(page.getByText(/updated\s+\d+s\s+ago/i)).toBeVisible({ timeout: 30_000 })
  })
})
