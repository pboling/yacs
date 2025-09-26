# React + TypeScript + Vite

This React app is built with Vite. It provides HMR and some ESLint rules.

This repository uses [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) (uses [Babel](https://babeljs.io/)) for React Fast Refresh during development.
See vite.config.ts where the plugin is configured.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Usage

This repo is a React 19 + TypeScript 5 + Vite 7 (Rolldown) app. Below are the essential commands to develop, build, lint, and test it locally.

- Prerequisites
  - Node.js >= 20 (validated with Node 23). ESM only (package.json has "type": "module").
  - Any package manager works (npm/pnpm/yarn). Examples here use npm.

- Install
  - npm ci (preferred for reproducible installs) or npm install

- Dev server
  - Frontend: npm run dev → starts Vite dev server with React Fast Refresh on http://localhost:5173
  - Backend: npm run server → starts the Express backend on http://localhost:3001 providing GET /scanner
  - The frontend REST client in dev defaults to http://localhost:3001 unless VITE_API_BASE is set. Set VITE_API_BASE to override.
  - WebSocket is proxied in dev at /ws to wss://api-rs.dexcelerate.com/ws (vite.config.ts keeps only the WS proxy).

- Production build
  - npm run build → runs TypeScript project build (tsc -b) for type-checking only (noEmit), then Vite build.
  - TypeScript uses project references via tsconfig.json (tsconfig.app.json for src, tsconfig.node.json for config files).

- Preview production build
  - npm run preview → serves the built dist/ folder.

- Linting
  - npm run lint → ESLint (flat config) with type-aware rules and React rules. Targets **/\*.ts, **/\*.tsx; ignores dist/.

- Testing (dependency-free)
  - Uses Node’s built-in test runner (node:test). Tests live under tests/ and some src/\*.test.js.
  - Run all discovered tests: node --test
  - Run a specific folder/file: node --test tests or node --test tests/scanner.client.test.js
  - Inline demo: node --input-type=module --eval "import test from 'node:test'; import assert from 'node:assert/strict'; await test('ok', () => assert.ok(true));"

## E2E tests (Playwright)

This repo includes UI end-to-end tests using Playwright that validate live WebSocket updates and client WS setup.

- One-time setup
  - Install browsers: npx playwright install

- Running tests
  - All e2e tests: npm run test:e2e
  - Interactive UI mode: npm run test:e2e:ui

- What the runner does
  - The Playwright config (playwright.config.ts) auto-starts the dev stack via npm run dev:serve (backend + Vite dev server) and waits for http://localhost:5173.
  - Tests live under e2e/ and include:
    - ws-setup.spec.ts → asserts the app establishes a WebSocket connection (waits for a page websocket and window.**APP_WS** to be OPEN).
    - ws-sells-updates.spec.ts → asserts that the first row in both tables updates within a timeout, indicating live data flow.

- Troubleshooting
  - If you don’t see updates, open the browser console: extensive logs have been added under the WS and TokensPane prefixes to trace what’s happening.
  - Ensure ports 5173 (frontend) and 3001 (backend) are available or adjust your environment accordingly.

- WebSocket usage during dev
  - For real data, connect to ws://localhost:5173/ws (dev proxy). Send subscribe messages per README sections below.

Note on CORS: The dev proxy avoids the need for a CORS extension during development when you use relative URLs as shown above. If you bypass the proxy and hit the public API directly from the browser, a CORS extension may be required.

## Requirements

Runtime behavior (dev and prod): On page load, the app performs an initial GET /scanner to fetch the initial dataset for both tables, and it also opens a WebSocket connection and subscribes to updates (scanner-filter and per-pair/per-pair-stats). This is true in all environments.

### 1. Component Structure

Create a React component with:

- **Two side-by-side tables**
- **Table 1**: "Trending Tokens" - default sorted by volume, should be sortable by any column
- **Table 2**: "New Tokens" - sorted by age (newest first)
- **Real-time data updates** via WebSocket
- **Filtering capabilities** for both tables
- **Throughput**: The tables should be able to scroll and render more than 1000 rows without performance issues

### 2. Data Structure

Each token row should display the following information:

```typescript
interface TokenData {
  id: string
  tokenName: string
  tokenSymbol: string
  tokenAddress: string
  pairAddress: string
  chain: 'ETH' | 'SOL' | 'BASE' | 'BSC'
  exchange: string // this is the router or virtualRouter fields
  priceUsd: number
  volumeUsd: number
  mcap: number
  priceChangePcs: {
    '5m': number
    '1h': number
    '6h': number
    '24h': number
  }
  transactions: {
    buys: number
    sells: number
  }
  audit: {
    mintable: boolean
    freezable: boolean
    honeypot: boolean
    contractVerified: boolean
  }
  tokenCreatedTimestamp: Date
  liquidity: {
    current: number
    changePc: number
  }
}
```

### 3. Table Columns

Display these columns

**Essential columns:**

- Token Name/Symbol (with chain name)
- Exchange (router or virtualRouter)
- Price (USD)
- Market Cap (see Market Cap Calculation section below)
- Volume (24h)
- Price Change (5m, 1h, 6h, 24h)
- Age
- Buys/Sells count
- Liquidity

**Optional columns:**

- Audit indicators (verified, mintable, etc.)
- Social links indicators

### 4. Required API Integration

#### REST API Endpoint

```
GET /scanner
```

**Parameters:** See `GetScannerResultParams` in `test-task-types.ts`

Server-side sorting (initial REST load): The /scanner endpoint accepts optional allow-listed parameters to return the initial page pre-sorted so URLs can be bookmarked and shared.

- sort: one of tokenName, exchange, price, priceUsd, mcap, volume, volumeUsd, age, tx, liquidity
- dir: one of asc, desc (default: desc)

Examples:

- /scanner?chain=ETH&page=1&sort=volume&dir=desc
- /scanner?chain=SOL&page=1&sort=age&dir=asc
- /scanner?page=1&sort=mcap (defaults to dir=desc)

Notes:

- Sorting is applied only to the initial REST payload; live updates over WebSocket still update values in-place. Client-side sorting can still be toggled in the UI independently.
- Invalid values are ignored (endpoint falls back to unsorted for sort; dir falls back to desc) — parameters are validated against an allow-list on the server.

**Response:** See `ScannerApiResponse` and `ScannerResult` in `test-task-types.ts`

### Price Updates

**Important**: The initial API response provides starting prices, but for real-time price updates you must handle **tick events** from WebSocket.

When tick events are received:

1. Extract the latest valid swap from `swaps` array (ignore swaps where `isOutlier: true`)
2. Update token price using `priceToken1Usd` from the latest swap
3. Recalculate market cap using: `totalSupply * newPrice`
4. Update transaction counts (buys/sells) and volume

Example tick event handling:

```typescript
// From tick event data.swaps, get the latest non-outlier swap
const latestSwap = swaps.filter((swap) => !swap.isOutlier).pop()
if (latestSwap) {
  const newPrice = parseFloat(latestSwap.priceToken1Usd)
  const newMarketCap = totalSupply * newPrice
  // Update your token data with newPrice and newMarketCap
}
```

### Market Cap Calculation

The API `scanner` response includes these fields for market cap calculation:

- `currentMcap: string`
- `initialMcap: string`
- `pairMcapUsd: string`
- `pairMcapUsdInitial: string`
- `token1TotalSupplyFormatted: string`
- `token1Decimals: string`
- `price: string`

Market cap is calculated using this priority order from the API response:

1. `currentMcap` - if > 0
2. `initialMcap` - if > 0
3. `pairMcapUsd` - if > 0
4. `pairMcapUsdInitial` - if > 0
5. Fallback to 0

Alternative calculation (once real time price updates start flowing in):

```typescript
const totalSupply = parseFloat(token1TotalSupplyFormatted)
const marketCap = totalSupply * parseFloat(price)
```

### Lexicon

- Swap: A single trade on a pair. Provided in tick events as elements of data.swaps. Relevant fields:
  - priceToken1Usd: USD price implied for token1 in this swap. Used to update priceUsd.
  - amountToken1: Absolute token1 amount traded in this swap. Used to accumulate volumeUsd as price × |amountToken1|.
  - tokenInAddress: Address of the token sent into the pool for this swap. Used to classify buys (token0 in) vs sells (token1 in).
  - token0Address: Base token of the pair (e.g., WETH/WSOL/WBNB). When known, it makes buy/sell classification exact.
  - isOutlier: True when the swap should be ignored for price/volume/tx counts. The app filters these out.
- Tick: A WebSocket event carrying recent swaps for a pair. Shape: { event: 'tick', data: { pair, swaps } }. The reducer picks the latest non-outlier swap to set price, then recalculates mcap and updates volume and transactions.
- Pair: The liquidity pool (pairAddress) that trades between token0 (base/wrapped coin) and token1 (the tracked token).
- token1: The tracked token for the table row. token1Address identifies it. Its priceUsd is derived from swaps.priceToken1Usd.
- token0: The base/quote token in the pool (e.g., WETH, WSOL). token0Address may arrive via swaps; until known, buy/sell inference falls back to heuristics.
- Market Cap (mcap): Market capitalization of token1. Initially taken from scanner fields; after ticks, recalculated as totalSupply × priceUsd.
- totalSupply: token1TotalSupplyFormatted from scanner. Used with new price to compute mcap.
- Volume (volumeUsd): Cumulative USD volume computed from non-outlier swaps: sum(price × |amountToken1|).
- Transactions: Count of buys and sells derived from non-outlier swaps using tokenInAddress vs token0Address/token1Address.
- Liquidity: Displayed as liquidity.current and liquidity.changePc. current drifts deterministically based on price percent changes in the reducer to provide a stable demo.
- Scanner: Initial dataset source. REST GET /scanner and WS event scanner-pairs/scanner-append provide TokenData rows for pages (Trending/New) and parameters for subsequent per-pair subscriptions.
- Pair Stats: WebSocket event pair-stats that updates audit flags (mintable, freezable, honeypot, contractVerified), social links, and migrationPc.
- WPEG Prices: WebSocket event wpeg-prices delivering a map of wrapped native token prices by chain (used for potential conversions).
- Exchange (router): The DEX router or virtual router identifier shown in the Exchange column.
- Chain: One of ETH, SOL, BASE, BSC. Chain IDs map to names in code: 1→ETH, 56→BSC, 8453→BASE, 900→SOL, 11155111→ETH (sepolia treated as ETH).
- Age: tokenCreatedTimestamp from scanner, displayed as how long the token has existed.
- Honeypot: Audit flag indicating whether a token is likely unsafe to sell. In this app, honeypot is derived as !pair.token1IsHoneypot from pair-stats.

### 5. Required WebSocket Integration

#### Connection & Subscription

Connect to WebSocket and subscribe to scanner updates:

```javascript
// Subscribe to scanner data
const subscribeMessage = {
  event: 'scanner-filter',
  data: {
    rankBy: 'volume', // or "age"
    chain: 'SOL',
    isNotHP: true,
  },
}

// Unsubscribe
const unsubscribeMessage = {
  event: 'unsubscribe-scanner-filter',
  data: {
    // same filter params as subscribe
  },
}
```

To send a ws subscription:

```javascript
const ws = new WebSocket('wss://api-rs.dexcelerate.com/ws')
ws.send(JSON.stringify(subscribeMessage))
```

### Pair Stats Updates

**Important**: Handle **pair-stats events** for audit field updates, migration progress, and liquidity lock status.

When pair-stats events are received, update these fields:

**Audit Fields**:

- `mintable`: `pairStatsData.data.pair.mintAuthorityRenounced`
- `freezable`: `pairStatsData.data.pair.freezeAuthorityRenounced`
- `honeypot`: `!pairStatsData.data.pair.token1IsHoneypot`
- `contractVerified`: `pairStatsData.data.pair.isVerified`
- `linkDiscord`: `pairStatsData.data.pair.linkDiscord`
- `linkTelegram`: `pairStatsData.data.pair.linkTelegram`
- `linkTwitter`: `pairStatsData.data.pair.linkTwitter`
- `linkWebsite`: `pairStatsData.data.pair.linkWebsite`
- `dexPaid`: `pairStatsData.data.pair.dexPaid`

Example pair-stats handling:

```typescript
// Handle pair-stats event
if (pairStatsEvent.event === 'pair-stats') {
  const data = pairStatsEvent.data
  const updatedToken = {
    ...token,
    migrationPc: Number(data.migrationProgress),
    audit: {
      mintable: data.pair.mintAuthorityRenounced,
      freezable: data.pair.freezeAuthorityRenounced,
      honeypot: !data.pair.token1IsHoneypot,
      contractVerified: token.audit.contractVerified, // preserve existing
    },
  }
}
```

**Required Pair Stats Subscription**: You must subscribe to individual pair-stats rooms for each token:

```javascript
ws.send(
  JSON.stringify({
    event: 'subscribe-pair-stats',
    data: {
      pair: token.pairAddress,
      token: token.tokenAddress,
      chain: token.chain,
    },
  }),
)
```

**Required Pair Subscription for Tick Events**: You must also subscribe to individual pair rooms for each token to receive real-time price updates:

```javascript
ws.send(
  JSON.stringify({
    event: 'subscribe-pair',
    data: {
      pair: token.pairAddress,
      token: token.tokenAddress,
      chain: token.chain,
    },
  }),
)
```

**Required Scanner Filters Subscription**: You must subscribe to scanner-filter room to receive bulk token data:

```javascript
ws.send(
  JSON.stringify({
    event: 'scanner-filter',
    data: scannerFilterParams,
  }),
)
```

### WebSocket Subscription Notes

1. **Price Change Percentages**: These come from the API response (`diff5M`, `diff1H`, `diff6H`, `diff24H`) - NOT calculated from tick events
2. **Triple Subscriptions Required**: Subscribe to these websocket rooms
   - `scanner-filter` - for bulk token data
   - `pair-stats` subscriptions for each token - for audit updates and migration progress
   - `pair` subscriptions for each token - for real-time tick price updates

3. **Real-time Updates**: Handle these WebSocket events:
   - `scanner-pairs` - Full dataset replacement
   - `tick` - Price/volume updates
   - `pair-stats` - Audit/migration updates
4. **Data Persistence**:
   - Preserve existing price/mcap data when receiving scanner-pairs updates
   - If a pair no longer exists in the scanner-pairs for it's respective page number, remove it from the table

#### WebSocket Message Types to Handle

All incoming WebSocket message types are defined in `test-task-types.ts`. See `IncomingWebSocketMessage` for the complete union type.

### 6. Technical Requirements

#### Real-time Updates

- Subscribe to relevant WebSocket events
- Update token data when price/volume changes occur
- Handle new tokens being added
- Maintain proper sorting when data updates

#### Filtering & Sorting

- Implement client-side filtering controls:
  - Chain selection (ETH, SOL, BASE, BSC)
  - Minimum volume filter
  - Maximum age filter
  - Minimum Market Cap filter
  - Exclude honeypot checkbox
- Server-side sorting via API parameters

#### UI/UX

- Loading states
- Error states
- Empty states
- Color coding for price changes (green/red)

### 7. Deliverables

1. **React App** - Runnable single-page React/Next/Vite app with just the tables and filters
2. **API Integration** - Working REST API calls
3. **WebSocket Integration** - Real-time data updates
4. **Styling** - You can use whatever you want for the UI as long as it looks decent
5. **Documentation** - Brief README explaining your approach
6. **Error Handling** - Proper error states and recovery

### 8. Bonus Points

- Unit tests
- Chart integration (mini price charts)
- Export functionality
- Advanced filtering options

### API Base URL

`https://api-rs.dexcelerate.com`;
For ws connection use:
`wss://api-rs.dexcelerate.com/ws`;

### API notes:

You will have to use a no-cors extension from the Chrome web store during development
`https://chromewebstore.google.com/detail/allow-cors-access-control/` - or any other extension with similar functionality.

### Dev proxy (added)

- The Vite dev server proxies API and WebSocket calls to avoid CORS during development.
- REST: fetch('/scanner?…') → proxies to https://api-rs.dexcelerate.com/scanner
- WS: new WebSocket('ws://localhost:5173/ws') → proxies to wss://api-rs.dexcelerate.com/ws
- The client prefers a relative base in dev; you can override with VITE_API_BASE.
  - Example: echo "VITE_API_BASE=/" > .env.local to force relative base; default behavior already uses relative base in dev.

### Local mock data with reproducible seed

- The local deterministic mock for /scanner is ENABLED by default during development. You can control it with env vars:
  - Force-enable mock: set LOCAL_SCANNER=1 (or VITE_USE_LOCAL_SCANNER=1)
  - Disable mock: set LOCAL_SCANNER=0 (or VITE_USE_LOCAL_SCANNER=0)
  - Switch to public API and enable proxies: set USE_PUBLIC_API=1 (or VITE_USE_PUBLIC_API=1)
- Seed sources (first match wins): VITE_SEED, SEED, then the content of a .seed file in the project root; fallback to an internal default.
- Examples:
  - Default (mock on): npm run dev
  - Use a specific seed: VITE_SEED=12345 npm run dev
  - Use public API via proxy: USE_PUBLIC_API=1 npm run dev
  - Disable mock without proxies (you provide /scanner): LOCAL_SCANNER=0 npm run dev
- The REST endpoint /scanner will return data derived from the seed and request params, so the same seed and params always produce the same dataset.
- This allows you to test initial load without relying on the public API.

### Testing notes

- Playwright E2E (browser WebSocket validation)
  - Install browsers once: npx playwright install --with-deps (or rely on CI preinstall)
  - Run servers + tests: npm run test:e2e (playwright.config.ts starts both Vite and the local backend via npm run dev:serve)
  - UI mode: npm run test:e2e:ui
- Minimal regression tests exist using Node's built-in test runner. Run all tests with: node --test
- Deterministic mock generation is covered by tests/seed.test.js.
- The Vite dev server proxies API and WebSocket calls to avoid CORS during development.
- REST: fetch('/scanner?…') → proxies to https://api-rs.dexcelerate.com/scanner
- WS: new WebSocket('ws://localhost:5173/ws') → proxies to wss://api-rs.dexcelerate.com/ws
- The client prefers a relative base in dev; you can override with VITE_API_BASE.
  - Example: echo "VITE_API_BASE=/" > .env.local to force relative base; default behavior already uses relative base in dev.

## Development server expectations (no fallbacks)

- The Vite dev server always proxies REST and WS to a local backend at http://localhost:3001.
  - REST: fetch('/scanner?...') → proxies to http://localhost:3001/scanner
  - WS: new WebSocket('ws://localhost:5173/ws') → proxies to ws://localhost:3001/ws
- There are no automatic REST fallbacks in development. If the backend is not running, requests will fail and errors will surface in the console/logs. This is intentional to validate primary functionality.
- Start both servers together during development/testing with:
  - npm run dev:serve (starts the Express backend and the Vite dev server)

Notes:

- You can still point the frontend at another API by setting VITE_API_BASE (e.g., to the public API), but by default the app assumes the local backend on port 3001.
- WebSocket errors will surface; the client retries a limited number of times for developer visibility but does not switch to any mock WS.

## WebSocket channels overview and boot overlay

- scanner-filter → server listens for this subscription and responds with scanner-pairs for the requested filter (page, rankBy, chain, etc.). This is the primary/bootstrap stream that seeds the tables. You should consider it the “main” subscription.
- scanner-pairs / scanner-append → full dataset replacement or incremental additions for a page. The app reducer ingests these to populate state.pages and byId.
- subscribe-pair / unsubscribe-pair → per-row real-time tick updates (price, volume, buys/sells). The client gates these by viewport to reduce load.
- subscribe-pair-stats / unsubscribe-pair-stats → per-row audit/security/migration updates. Also gated by viewport.
- wpeg-prices → occasional broadcast with wrapped-native prices by chain.

Boot/loading behavior

- The app shows a full-screen loading overlay during startup. It dismisses when either the WebSocket is OPEN or both tables have initialized their pages (from REST/WS). This avoids a deadlock where the UI wouldn’t mount if the WS is slow/unavailable.
- In test/automation contexts, the overlay can be bypassed via navigator.webdriver, ?e2e=1, or window.**BYPASS_BOOT** = true.

## Linting Profiles & Code Style

This project uses **ESLint (flat config)** with two profiles and **Prettier** in compatibility mode.

### Profiles

- Development: `npm run lint`
  - Warnings allowed (style + exploratory TypeScript warnings)
  - Prettier issues appear as warnings (`prettier/prettier`)
  - Encourages iterative cleanup without blocking local dev
- CI: `npm run lint:ci`
  - Loads `eslint.ci.config.js` which promotes selected high-signal rules to errors:
    - `@typescript-eslint/no-unused-vars`
    - `@typescript-eslint/no-unsafe-assignment`
    - `@typescript-eslint/no-unsafe-member-access`
    - `@typescript-eslint/restrict-plus-operands`
    - `@typescript-eslint/restrict-template-expressions`
    - `@typescript-eslint/no-unnecessary-type-conversion`
  - Fails build on any error or (because of `--max-warnings=0`) unexpected warnings

### Prettier Integration

Prettier is run separately for formatting but also integrated into ESLint via `eslint-plugin-prettier` (compatibility mode):

- Config: `.prettierrc.json` (100 col width, no semicolons, single quotes, trailing commas)
- ESLint disables conflicting stylistic rules using `eslint-config-prettier`
- Style violations surface as `prettier/prettier` warnings locally (can be promoted in CI later if desired)

### Scripts

| Command                   | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| `npm run lint`            | Dev lint (warnings OK)                         |
| `npm run lint:fix`        | Auto-fix (dev profile)                         |
| `npm run lint:ci`         | CI gating lint (errors only, max warnings = 0) |
| `npm run lint:ci:fix`     | Same as above but attempts fixes first         |
| `npm run format:prettier` | Apply Prettier formatting to all source files  |
| `npm run format:check`    | Verify formatting without writing              |
| `npm run format`          | Run Prettier write, then ESLint --fix          |

### Recommended Workflow

1. Make code changes
2. Run `npm run format` (fast full-project formatting + lint fixes)
3. Run `npm run lint` to inspect any residual warnings
4. Before commit / pre-push hook: run `npm run lint:ci`

### Adding a Pre-Push Hook (Optional)

```
npx husky add .husky/pre-push "npm run lint:ci && npm test"
```

### Promoting More Rules in CI

Edit `eslint.ci.config.js` and append rule names to the `promoteToError` array. For style-only enforcement, change `'prettier/prettier': 'warn'` to `'error'` in the Prettier block.

---
