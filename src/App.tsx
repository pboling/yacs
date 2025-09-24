import { useMemo } from 'react'
import './App.css'
import {
  NEW_TOKENS_FILTERS,
  TRENDING_TOKENS_FILTERS,
  type GetScannerResultParams,
  type ScannerApiResponse,
  type ScannerResult,
  chainIdToName,
} from './test-task-types'

function App() {
  // Demonstrate usage of the required types without altering them
  const trendingFilters: GetScannerResultParams = TRENDING_TOKENS_FILTERS
  const newFilters: GetScannerResultParams = NEW_TOKENS_FILTERS

  // Example mapping function signature using ScannerResult and chainIdToName
  const demoMap = useMemo(() => {
    const example: ScannerResult = {
      age: new Date().toISOString(),
      bundlerHoldings: '0',
      callCount: 0,
      chainId: 1,
      contractRenounced: false,
      contractVerified: false,
      currentMcap: '0',
      devHoldings: '0',
      dexPaid: false,
      diff1H: '0',
      diff24H: '0',
      diff5M: '0',
      diff6H: '0',
      fdv: '0',
      first1H: '0',
      first24H: '0',
      first5M: '0',
      first6H: '0',
      initialMcap: '0',
      insiderHoldings: '0',
      isFreezeAuthDisabled: false,
      isMintAuthDisabled: false,
      liquidity: '0',
      liquidityLocked: false,
      liquidityLockedAmount: '0',
      liquidityLockedRatio: '0',
      migratedFromVirtualRouter: null,
      virtualRouterType: null,
      pairAddress: '0x',
      pairMcapUsd: '0',
      pairMcapUsdInitial: '0',
      percentChangeInLiquidity: '0',
      percentChangeInMcap: '0',
      price: '0',
      reserves0: '0',
      reserves0Usd: '0',
      reserves1: '0',
      reserves1Usd: '0',
      routerAddress: '0x',
      sniperHoldings: '0',
      snipers: 0,
      token0Decimals: 18,
      token0Symbol: 'WETH',
      token1Address: '0x',
      token1Decimals: '18',
      token1Name: 'Token',
      token1Symbol: 'TKN',
      token1TotalSupplyFormatted: '0',
      top10Holdings: '0',
      volume: '0',
    }
    const chainName = chainIdToName(example.chainId)
    return { chainName }
  }, [])

  // Placeholder UI – real implementation should fetch and render tables per README
  return (
    <div style={{ padding: 16 }}>
      <h1>Dexcelerate Scanner (Placeholder)</h1>
      <p>Trending filters: {JSON.stringify(trendingFilters)}</p>
      <p>New filters: {JSON.stringify(newFilters)}</p>
      <p>Demo chainIdToName: {demoMap.chainName}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section>
          <h2>Trending Tokens</h2>
          <div style={{ border: '1px solid #ccc', padding: 8 }}>Table goes here.</div>
        </section>
        <section>
          <h2>New Tokens</h2>
          <div style={{ border: '1px solid #ccc', padding: 8 }}>Table goes here.</div>
        </section>
      </div>
    </div>
  )
}

export default App
