// ===== BASIC TYPES =====

export type SupportedChainName = "ETH" | "SOL" | "BASE" | "BSC";
export type SupportedChainId = "1" | "11155111" | "900" | "8453" | "56";

export type OrderBy = "asc" | "desc";
export type TimeFrame = "5M" | "1H" | "6H" | "24H";
export type SerdeRankBy =
  | "price5M"
  | "price1H"
  | "price6H"
  | "price24H"
  | "volume"
  | "txns"
  | "buys"
  | "sells"
  | "trending"
  | "age"
  | "liquidity"
  | "mcap"
  | "migration";

// ===== API REQUEST TYPES =====

/**
 * Query parameters for GET /scanner
 * These are the filters you can apply to get different token sets
 */
export interface GetScannerResultParams {
  // Essential filters
  chain?: null | SupportedChainName;
  orderBy?: OrderBy;
  rankBy?: SerdeRankBy;
  timeFrame?: TimeFrame;
  page?: number | null;

  // Security filters
  isNotHP?: boolean | null; // exclude honeypots
  isVerified?: boolean | null;

  // Volume filters
  minVol24H?: number | null;
  maxVol24H?: number | null;

  // Age filters (in seconds)
  minAge?: number | null;
  maxAge?: number | null;

  // Liquidity filters
  minLiq?: number | null;
  maxLiq?: number | null;

  // Transaction filters
  minBuys24H?: number | null;
  minSells24H?: number | null;
  minTxns24H?: number | null;

  // Array filters for advanced use
  dexes?: string[] | null;
  virtualDexes?: string[] | null;
}

// ===== API RESPONSE TYPES =====

/**
 * Raw scanner result from the API - this is what you get from GET /scanner
 */
export interface ScannerResult {
  /** @format date-time */
  age: string;
  bundlerHoldings: string;
  /** @format float */
  buyFee?: number | null;
  /**
   * @format int64
   * @min 0
   */
  buys?: number | null;
  /**
   * @format int32
   * @min 0
   */
  callCount: number;
  /**
   * @format int64
   * @min 0
   */
  chainId: number;
  contractRenounced: boolean;
  contractVerified: boolean;
  currentMcap: string;
  devHoldings: string;
  dexPaid: boolean;
  diff1H: string;
  diff24H: string;
  diff5M: string;
  diff6H: string;
  discordLink?: string | null;
  fdv: string;
  first1H: string;
  first24H: string;
  first5M: string;
  first6H: string;
  honeyPot?: boolean | null;
  initialMcap: string;
  insiderHoldings: string;
  /**
   * @format int64
   * @min 0
   */
  insiders: number;
  isFreezeAuthDisabled: boolean;
  isMintAuthDisabled: boolean;
  liquidity: string;
  liquidityLocked: boolean;
  liquidityLockedAmount: string;
  liquidityLockedRatio: string;
  /**
   * @format int64
   * @min 0
   */
  makers?: number | null;
  migratedFromVirtualRouter: null | string;
  virtualRouterType: null | string;
  migratedFromPairAddress?: null | string;
  migratedFromRouterAddress?: null | string;
  migrationProgress?: string | null;
  pairAddress: string;
  pairMcapUsd: string;
  pairMcapUsdInitial: string;
  percentChangeInLiquidity: string;
  percentChangeInMcap: string;
  price: string;
  reserves0: string;
  reserves0Usd: string;
  reserves1: string;
  reserves1Usd: string;
  routerAddress: string;
  /** @format float */
  sellFee?: number | null;
  /**
   * @format int64
   * @min 0
   */
  sells?: number | null;
  sniperHoldings: string;
  /**
   * @format int64
   * @min 0
   */
  snipers: number;
  telegramLink?: string | null;
  /** @format int32 */
  token0Decimals: number;
  token0Symbol: string;
  token1Address: string;
  token1Decimals: string;
  token1ImageUri?: string | null;
  token1Name: string;
  token1Symbol: string;
  token1TotalSupplyFormatted: string;
  top10Holdings: string;
  twitterLink?: string | null;
  /**
   * @format int64
   * @min 0
   */
  txns?: number | null;
  volume: string;
  webLink?: string | null;
}

/**
 * API response structure from GET /scanner
 */
export interface ScannerApiResponse {
  pairs: ScannerResult[];
  totalRows: number;
}


// ===== WEBSOCKET SUBSCRIPTION TYPES =====

/**
 * Outgoing WebSocket messages you need to send
 */
export interface ScannerSubscriptionMessage {
  event: "scanner-filter";
  data: GetScannerResultParams;
}

export interface ScannerUnsubscriptionMessage {
  event: "unsubscribe-scanner-filter";
  data: GetScannerResultParams;
}

/**
 * IMPORTANT: You must subscribe to the pair room for each token to receive tick events
 */
export interface PairSubscriptionMessage {
  event: "subscribe-pair";
  data: {
    pair: string;
    token: string;
    chain: string;
  };
}

export interface PairUnsubscriptionMessage {
  event: "unsubscribe-pair";
  data: {
    pair: string;
    token: string;
    chain: string;
  };
}

export interface PairStatsSubscriptionMessage {
  event: "subscribe-pair-stats";
  data: {
    pair: string;
    token: string;
    chain: string;
  };
}

export interface PairStatsUnsubscriptionMessage {
  event: "unsubscribe-pair-stats";
  data: {
    pair: string;
    token: string;
    chain: string;
  };
}


export type OutgoingWebSocketMessage =
  | ScannerSubscriptionMessage
  | ScannerUnsubscriptionMessage
  | PairSubscriptionMessage
  | PairUnsubscriptionMessage
  | PairStatsSubscriptionMessage
  | PairStatsUnsubscriptionMessage;


// ===== WEBSOCKET INCOMING MESSAGE TYPES =====

/**
 * Individual swap transaction in real-time updates
 */
export interface WsTokenSwap {
  timestamp: string;
  addressTo: string;
  addressFrom: string;
  token0Address: string;
  amountToken0: string;
  amountToken1: string;
  priceToken0Usd: string;
  priceToken1Usd: string;
  tokenInAddress: string; // tells you which token was bought
  isOutlier: boolean; // ignore outlier swaps
}

/**
 * Payload for subscribing to pair-specific updates
 */
export interface PairSubscriptionPayload {
  pair: string;   // pair address
  token: string;  // token address
  chain: SupportedChainName;
}
/**
 * Real-time price and volume updates
 * You'll receive this for tokens you're subscribed to
 * 
 * IMPORTANT: To receive tick events, you must first subscribe to the pair room
 * for each token by sending a "subscribe-pair" WebSocket message with the
 * pair address, token address, and chain.
 */
export interface TickEventPayload {
  pair: PairSubscriptionPayload;
  swaps: WsTokenSwap[];
}

/**
 * Pair statistics updates (migration progress, audit changes, etc.)
 */
export interface PairStatsMsgData {
  pair: ScannerPairDetails;
  pairStats: TimeframesPairStats;
  migrationProgress: string;
  callCount: number;
}

export interface ScannerPairDetails {
  token1SniperWalletToTotalSupplyRatio: string;
  token1BundlerWalletToTotalSupplyRatio: string;
  traders: number;
  bundlers: number;
  /** holdings of bundlers */
  bundlerHoldings?: string | null;
  /** The amount of liquidity burned */
  burnedAmount?: string;
  burnedSupply: string;
  chain: SupportedChainName;
  /** holdings of dev */
  devHoldings?: string | null;
  /** dexscreener paid status */
  dexPaid: boolean;
  /** The (token1 total supply - burned tokens) * token1 price usd */
  fdv: string;
  freezeAuthorityRenounced: boolean;
  /** holdings of insiders */
  insiderHoldings?: string | null;
  /**
   * number of insiders still holding
   * @format int64
   * @min 0
   */
  insiders: number;
  /** Used to indicate a migration is in progress */
  isMigrating?: boolean | null;
  isVerified: boolean;
  linkDiscord?: string | null;
  linkTelegram?: string | null;
  linkTwitter?: string | null;
  linkWebsite?: string | null;
  lockedAmount?: string;
  /** The previous pair address before migration */
  migratedFromPairAddress?: null | string;
  migratedFromRouterAddress?: null | string;
  /** When a pumpfun (or similar) pair successfully migrates to raydium */
  migratedToPairAddress?: null | string;
  migratedFromVirtualRouter: null | string;
  virtualRouterType: null | string;
  mintAuthorityRenounced: boolean;
  pairAddress: string;
  /** @format date-time */
  pairCreatedAt: string;
  /** The usd value of the liquidity pool */
  pairMarketcapUsd: string;
  /** The initial usd value of the liquidity pool */
  pairMarketcapUsdInitial?: string;
  /** The usd price of token0 in the pair */
  pairPrice0Usd: string;
  /** The usd price of token1 in the pair */
  pairPrice1Usd: string;
  /** The number of token0 tokens in the liquidity pool */
  pairReserves0: string;
  /** The total usd value of token0 tokens in the liquidity pool */
  pairReserves0Usd: string;
  /** The number of token1 tokens in the liquidity pool */
  pairReserves1: string;
  /** The total usd value of token1 tokens in the liquidity pool */
  pairReserves1Usd: string;
  /** The total supply of liquidity pool tokens */
  pairTotalSupply: string;
  renounced: boolean;
  routerAddress: string;
  routerType: string;
  /** total holdings of snipers */
  sniperHoldings?: string | null;
  /**
   * number of snipers still holding
   * @format int64
   * @min 0
   */
  snipers: number;
  token0Address: string;
  /** @format int32 */
  token0Decimals: number;
  token0Symbol: string;
  token1Address: string;
  /** @format float */
  token1BuyFee?: number | null;
  /** @format int32 */
  token1Decimals: number;
  token1DevWalletToTotalSupplyRatio?: string;
  /** Comes from "Token".extra_data in the "image" field */
  token1ImageUri?: string | null;
  token1IsHoneypot?: boolean | null;
  token1IsProxy: boolean;
  /** The maximum number of tokens that can be traded in a single swap */
  token1MaxTransaction?: string;
  token1MaxTransactionToTotalSupplyRatio?: string;
  /** The maximum number of tokens a wallet can hold */
  token1MaxWallet?: string;
  token1MaxWalletToTotalSupplyRatio?: string;
  token1Name: string;
  /** @format float */
  token1SellFee?: number | null;
  token1Symbol: string;
  /** The total supply of token1 */
  token1TotalSupply: string;
  /** The "formatted" total supply of token1 */
  token1TotalSupplyFormatted: string;
  /** @format float */
  token1TransferFee?: number | null;
  /** holdings of top10 */
  top10Holdings?: string | null;
  totalLockedRatio?: string;
}
export interface TimeframesPairStats {
  fiveMin: TimeFramePairStatsRef;
  oneHour: TimeFramePairStatsRef;
  sixHour: TimeFramePairStatsRef;
  twentyFourHour: TimeFramePairStatsRef;
}


export interface TimeFramePairStatsRef {
  buyVolume: string;
  /**
   * @format int64
   * @min 0
   */
  buyers: number;
  /**
   * @format int64
   * @min 0
   */
  buys: number;
  change: string;
  diff: string;
  first: string;
  last: string;
  /**
   * @format int64
   * @min 0
   */
  makers: number;
  sellVolume: string;
  /**
   * @format int64
   * @min 0
   */
  sellers: number;
  /**
   * @format int64
   * @min 0
   */
  sells: number;
  /**
   * @format int64
   * @min 0
   */
  txns: number;
  volume: string;
}


/**
 * Full dataset updates - this replaces your current data
 */
export interface ScannerPairsEventPayload {
  filter: GetScannerResultParams;
  results: {
    pairs: ScannerResult[];
  };
}


/**
 * All incoming WebSocket message types you need to handle
 */
export type IncomingWebSocketMessage =
  | { event: "tick"; data: TickEventPayload }
  | { event: "pair-stats"; data: PairStatsMsgData }
  | { event: "scanner-pairs"; data: ScannerPairsEventPayload };

/**
 * Helper to convert chain ID to chain name
 */
export function chainIdToName(chainId: number): SupportedChainName {
  switch (chainId.toString()) {
    case "1":
      return "ETH";
    case "56":
      return "BSC";
    case "8453":
      return "BASE";
    case "900":
      return "SOL";
    default:
      return "ETH";
  }
}


// ===== FILTER PRESETS =====

/**
 * Preset filters for the two tables
 */
export const TRENDING_TOKENS_FILTERS: GetScannerResultParams = {
  rankBy: "volume",
  orderBy: "desc",
  minVol24H: 1000, // minimum $1k volume
  isNotHP: true, // exclude honeypots
  maxAge: 7 * 24 * 60 * 60, // max 7 days old
};

export const NEW_TOKENS_FILTERS: GetScannerResultParams = {
  rankBy: "age",
  orderBy: "desc", // newest first
  maxAge: 24 * 60 * 60, // max 24 hours old
  isNotHP: true,
};
