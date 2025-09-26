// Token model/type used across the app (ESM)
// NOTE: Runtime objects in state.byId are plain JS objects coming from the reducer.
// We augment them with these fields in UI where needed. No reducer changes required.

export type SubscriptionState =
  | 'active'
  | 'ignored'
  | 'inactive-subscribed'
  | 'inactive-unsubscribed'

export interface TokenHistory {
  ts: number[]
  price: number[]
  mcap: number[]
  volume: number[]
  buys: number[]
  sells: number[]
  liquidity: number[]
}

export interface Token {
  id: string
  tokenName: string
  tokenSymbol: string
  chain: string
  exchange: string
  priceUsd: number
  mcap: number
  volumeUsd: number
  priceChangePcs: { '5m': number; '1h': number; '6h': number; '24h': number }
  tokenCreatedTimestamp: Date
  transactions: { buys: number; sells: number }
  liquidity: { current: number; changePc: number }
  audit?: {
    contractVerified?: boolean
    freezable?: boolean
    honeypot?: boolean
    linkDiscord?: string
    linkTelegram?: string
    linkTwitter?: string
    linkWebsite?: string
    renounced?: boolean
    locked?: boolean
    burned?: boolean
    dexPaid?: boolean
  }
  security?: { renounced?: boolean; locked?: boolean; burned?: boolean }
  // Optional fields present in reducer mapping; used to form WS subscription payloads when rows render
  pairAddress?: string
  tokenAddress?: string
  // Burn-related fields (when provided)
  totalSupply?: number
  burnedSupply?: number
  percentBurned?: number
  deadAddress?: string
  ownerAddress?: string

  // New subscription tracking fields
  subscriptionState?: SubscriptionState
  // Epoch millis of the last time this token was unsubscribed (from any state)
  lastUnsubscribedAt?: number

  // Persisted 1-hour rolling history for charts on load
  history?: TokenHistory
}
