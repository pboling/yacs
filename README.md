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
  - npm run dev → starts Vite dev server with React Fast Refresh (via @vitejs/plugin-react) on http://localhost:5173
  - API proxy is configured for development (see vite.config.ts):
    - REST: fetch('/scanner?...') → proxies to https://api-rs.dexcelerate.com/scanner
    - WS: new WebSocket('ws://localhost:5173/ws') → proxies to wss://api-rs.dexcelerate.com/ws
  - You can override the base via VITE_API_BASE if needed (e.g., echo "VITE_API_BASE=/" > .env.local). By default, dev prefers a relative base which works with the proxy.

- Production build
  - npm run build → runs TypeScript project build (tsc -b) for type-checking only (noEmit), then Vite build.
  - TypeScript uses project references via tsconfig.json (tsconfig.app.json for src, tsconfig.node.json for config files).

- Preview production build
  - npm run preview → serves the built dist/ folder.

- Linting
  - npm run lint → ESLint (flat config) with type-aware rules and React rules. Targets **/*.ts, **/*.tsx; ignores dist/.

- Testing (dependency-free)
  - Uses Node’s built-in test runner (node:test). Tests live under tests/ and some src/*.test.js.
  - Run all discovered tests: node --test
  - Run a specific folder/file: node --test tests or node --test tests/scanner.client.test.js
  - Inline demo: node --input-type=module --eval "import test from 'node:test'; import assert from 'node:assert/strict'; await test('ok', () => assert.ok(true));"

- WebSocket usage during dev
  - For real data, connect to ws://localhost:5173/ws (dev proxy). Send subscribe messages per README sections below.

Note on CORS: The dev proxy avoids the need for a CORS extension during development when you use relative URLs as shown above. If you bypass the proxy and hit the public API directly from the browser, a CORS extension may be required.

## Requirements

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
  id: string;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  pairAddress: string;
  chain: "ETH" | "SOL" | "BASE" | "BSC";
  exchange: string; // this is the router or virtualRouter fields
  priceUsd: number;
  volumeUsd: number;
  mcap: number;
  priceChangePcs: {
    "5m": number;
    "1h": number;
    "6h": number;
    "24h": number;
  };
  transactions: {
    buys: number;
    sells: number;
  };
  audit: {
    mintable: boolean;
    freezable: boolean;
    honeypot: boolean;
    contractVerified: boolean;
  };
  tokenCreatedTimestamp: Date;
  liquidity: {
    current: number;
    changePc: number;
  };
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
const latestSwap = swaps.filter((swap) => !swap.isOutlier).pop();
if (latestSwap) {
  const newPrice = parseFloat(latestSwap.priceToken1Usd);
  const newMarketCap = totalSupply * newPrice;
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
const totalSupply = parseFloat(token1TotalSupplyFormatted);
const marketCap = totalSupply * parseFloat(price);
```

### 5. Required WebSocket Integration

#### Connection & Subscription

Connect to WebSocket and subscribe to scanner updates:

```javascript
// Subscribe to scanner data
const subscribeMessage = {
  event: "scanner-filter",
  data: {
    rankBy: "volume", // or "age"
    chain: "SOL",
    isNotHP: true,
  },
};

// Unsubscribe
const unsubscribeMessage = {
  event: "unsubscribe-scanner-filter",
  data: {
    // same filter params as subscribe
  },
};
```

To send a ws subscription:

```javascript
const ws = new WebSocket("wss://api-rs.dexcelerate.com/ws");
ws.send(JSON.stringify(subscribeMessage));
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
if (pairStatsEvent.event === "pair-stats") {
  const data = pairStatsEvent.data;
  const updatedToken = {
    ...token,
    migrationPc: Number(data.migrationProgress),
    audit: {
      mintable: data.pair.mintAuthorityRenounced,
      freezable: data.pair.freezeAuthorityRenounced,
      honeypot: !data.pair.token1IsHoneypot,
      contractVerified: token.audit.contractVerified, // preserve existing
    },
  };
}
```

**Required Pair Stats Subscription**: You must subscribe to individual pair-stats rooms for each token:

```javascript
ws.send(
  JSON.stringify({
    event: "subscribe-pair-stats",
    data: {
      pair: token.pairAddress,
      token: token.tokenAddress,
      chain: token.chain,
    },
  })
);
```

**Required Pair Subscription for Tick Events**: You must also subscribe to individual pair rooms for each token to receive real-time price updates:

```javascript
ws.send(
  JSON.stringify({
    event: "subscribe-pair",
    data: {
      pair: token.pairAddress,
      token: token.tokenAddress,
      chain: token.chain,
    },
  })
);
```

**Required Scanner Filters Subscription**: You must subscribe to scanner-filter room to receive bulk token data:

```javascript
ws.send(
  JSON.stringify({
    event: "scanner-filter",
    data: scannerFilterParams,
  })
);
```

### Notes

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
- To generate deterministic mock data locally (no external API), enable the built-in mock server and set a seed:
  - Enable mock: set LOCAL_SCANNER=1 (or VITE_USE_LOCAL_SCANNER=1)
  - Seed sources (first match wins): VITE_SEED, SEED, then the content of a .seed file in the project root; fallback to an internal default.
  - Example:
    - On macOS/Linux: LOCAL_SCANNER=1 VITE_SEED=12345 npm run dev
    - Or create a .seed file containing a number (e.g., 987654321) and run: LOCAL_SCANNER=1 npm run dev
- The REST endpoint /scanner will return data derived from the seed and request params, so the same seed and params always produce the same dataset.
- This allows you to test initial load without relying on the public API.

### Testing notes
- Minimal regression tests exist using Node's built-in test runner. Run all tests with: node --test
- Deterministic mock generation is covered by tests/seed.test.js.
- The Vite dev server proxies API and WebSocket calls to avoid CORS during development.
- REST: fetch('/scanner?…') → proxies to https://api-rs.dexcelerate.com/scanner
- WS: new WebSocket('ws://localhost:5173/ws') → proxies to wss://api-rs.dexcelerate.com/ws
- The client prefers a relative base in dev; you can override with VITE_API_BASE.
  - Example: echo "VITE_API_BASE=/" > .env.local to force relative base; default behavior already uses relative base in dev.