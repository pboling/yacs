// JS runtime utilities for tests (ESM)
export function calcMarketCapFromResponse(scanner) {
  const toNum = (s) => (s ? parseFloat(s) : 0)
  const candidates = [scanner.currentMcap, scanner.initialMcap, scanner.pairMcapUsd, scanner.pairMcapUsdInitial]
  for (const c of candidates) {
    const v = toNum(c)
    if (v > 0) return v
  }
  return 0
}

function chainIdToName(chainId) {
  const map = {
    1: 'ETH',
    56: 'BSC',
    8453: 'BASE',
    900: 'SOL',
    11155111: 'ETH', // sepolia -> treat as ETH for display
  }
  return map[Number(chainId)] ?? 'ETH'
}

export function mapScannerResultToToken(scanner) {
  const chainName = chainIdToName(scanner.chainId)
  const priceUsd = parseFloat(scanner.price || '0') || 0
  const volumeUsd = parseFloat(scanner.volume || '0') || 0
  const mcap = calcMarketCapFromResponse(scanner)
  const tokenCreatedTimestamp = new Date(scanner.age)
  return {
    id: scanner.pairAddress || scanner.token1Address,
    tokenName: scanner.token1Name,
    tokenSymbol: scanner.token1Symbol,
    tokenAddress: scanner.token1Address,
    pairAddress: scanner.pairAddress,
    chain: chainName,
    exchange: scanner.routerAddress || scanner.virtualRouterType || scanner.migratedFromVirtualRouter || 'unknown',
    priceUsd,
    volumeUsd,
    mcap,
    priceChangePcs: {
      '5m': parseFloat(scanner.diff5M || '0') || 0,
      '1h': parseFloat(scanner.diff1H || '0') || 0,
      '6h': parseFloat(scanner.diff6H || '0') || 0,
      '24h': parseFloat(scanner.diff24H || '0') || 0,
    },
    transactions: {
      buys: scanner.buys ?? 0,
      sells: scanner.sells ?? 0,
    },
    audit: {
      mintable: !scanner.isMintAuthDisabled,
      freezable: !scanner.isFreezeAuthDisabled,
      honeypot: !!scanner.honeyPot,
      contractVerified: scanner.contractVerified,
    },
    tokenCreatedTimestamp,
    liquidity: {
      current: parseFloat(scanner.liquidity || '0') || 0,
      changePc: parseFloat(scanner.percentChangeInLiquidity || '0') || 0,
    },
  }
}

export function applyTickToToken(token, swaps, ctx) {
  const latest = swaps.filter((s) => !s.isOutlier).pop()
  if (!latest) return token
  const newPrice = parseFloat(latest.priceToken1Usd)
  const newMcap = ctx.totalSupply * newPrice
  let buys = 0
  let sells = 0
  let volumeDelta = 0
  for (const s of swaps) {
    if (s.isOutlier) continue
    const amt1 = parseFloat(s.amountToken1 || '0') || 0
    volumeDelta += parseFloat(s.priceToken1Usd || '0') * Math.abs(amt1)
    if (s.tokenInAddress.toLowerCase() === ctx.token0Address.toLowerCase()) buys++
    else if (s.tokenInAddress.toLowerCase() === ctx.token1Address.toLowerCase()) sells++
  }
  return {
    ...token,
    priceUsd: newPrice,
    mcap: newMcap,
    volumeUsd: token.volumeUsd + volumeDelta,
    transactions: {
      buys: token.transactions.buys + buys,
      sells: token.transactions.sells + sells,
    },
  }
}
