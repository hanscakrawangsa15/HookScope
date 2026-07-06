const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface HookSummary {
  id: string;
  address: string;
  chainId: number;
  name: string | null;
  description: string | null;
  deployedAt: string | null;
  deployer: string | null;
  isVerified: boolean;
  proxyType: string;
  callbacks: Record<string, boolean>;
  riskLevel: string;
  hookScore: number | null;
  auditStatus: string;
  tvlUsd: number | null;
  poolCount: number;
}

export interface HookDetail extends HookSummary {
  bytecodeHash: string | null;
  implementationAddress: string | null;
  functions: HookFunction[];
  sourceFiles: { name: string; language: string }[];
  securityFlags: SecurityFlag[];
  auditRecords: AuditRecord[];
  analytics: HookAnalytics | null;
  similarHooks: HookSummary[];
}

export interface HookFunction {
  id: string;
  name: string;
  signature: string;
  selector: string;
  params: Array<{ name: string; type: string }>;
  returns: Array<{ name: string; type: string }>;
  visibility: string;
  stateMutability: string;
  natspec: string | null;
  isCallback: boolean;
}

export interface SecurityFlag {
  id: string;
  category: string;
  severity: string;
  description: string;
  location: string | null;
  source: string;
  reportedBy: string | null;
}

export interface AuditRecord {
  id: string;
  auditor: string;
  reportUrl: string | null;
  auditDate: string;
  summary: string | null;
}

export interface HookAnalytics {
  tvlUsd: number;
  volume7dUsd: number;
  volume30dUsd: number;
  poolCount: number;
  uniqueLps: number;
  updatedAt: string;
}

export interface PaginatedHooks {
  data: HookSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TopHookEntry {
  address: string;
  name: string | null;
  chainId: number;
  riskLevel: string;
  hookScore: number | null;
  tvlUsd: number;
  poolCount: number;
  swapCount: number;
  volume7dUsd: number;
  volume30dUsd: number;
}

export interface SwapPool {
  id: string;
  poolId: string;
  chainId: number;
  token0: string;
  token1: string;
  token0Symbol: string | null;
  token1Symbol: string | null;
  fee: number;
  tickSpacing: number;
  tvlUsd: number | null;
}

export interface PoolKeyInput {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export interface SwapQuote {
  amountIn: string;
  amountOut: string;
  gasEstimate: string;
  priceImpactBps: number | null;
}

export interface SwapBuildResult {
  to: string;
  data: string;
  value: string;
  permit2Address: string;
  deadline: string;
}

export interface LpQuoteResult {
  amount0: string;
  amount1: string;
  liquidity: string;
  currentTick: number;
  sqrtPriceX96: string;
  tickSpacing: number;
  token0Decimals: number;
  token1Decimals: number;
}

export interface LpBuildResult {
  to: string;
  data: string;
  value: string;
  permit2Address: string;
  deadline: string;
}

export interface SolanaLpQuoteResult {
  tokenEstA: string;
  tokenEstB: string;
  liquidityEstimate: string;
  currentTick: number;
  sqrtPrice: string;
  tickSpacing: number;
  decimalsA: number;
  decimalsB: number;
}

export interface SolanaLpBuildResult {
  transactionBase64: string;
  positionMint: string;
}

export interface SolanaSwapQuoteResult {
  estimatedAmountIn: string;
  estimatedAmountOut: string;
  decimalsA: number;
  decimalsB: number;
  aToB?: boolean;
}

export interface SolanaSwapBuildResult {
  transactionBase64: string;
}

export interface PricePoint {
  timestamp: string;
  tick: number;
  price: number;
}

export interface SuggestRangeResult {
  tickLower: number;
  tickUpper: number;
  widthPct: number;
  trendBiasPct: number;
  sampleSize: number;
  usedFallback: boolean;
}

// AMM v4 / CPMM are plain constant-product pools — no tick range, no NFT
// position, just an auto-balanced two-token deposit.
export interface SimpleLpQuoteResult {
  tokenEstA: string;
  tokenEstB: string;
  decimalsA: number;
  decimalsB: number;
  price: number;
}

export interface SimpleLpBuildResult {
  transactionBase64: string;
}

export interface GlobalStats {
  totalHooks: number;
  verifiedHooks: number;
  unverifiedHooks: number;
  auditedHooks: number;
  flaggedHooks: number;
  totalPools: number;
  hooksByChain: Record<string, number>;
  hooksByRisk: Record<string, number>;
  recentHooks: Array<{ address: string; name: string | null; chainId: number; deployedAt: string | null; hookScore: number | null }>;
  topByTvl: TopHookEntry[];
  topByActivity: TopHookEntry[];
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    next: { revalidate: 30 },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const { error, detail } = err as { error?: string; detail?: string };
    throw new Error(detail ? `${error ?? "Request failed"}: ${detail}` : error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  priceHistory: {
    get: (address: string, poolId: string, params: { chainId?: number; period?: "1h" | "24h" | "7d" } = {}) => {
      const qs = new URLSearchParams({
        ...(params.chainId != null ? { chainId: String(params.chainId) } : {}),
        ...(params.period ? { period: params.period } : {}),
      });
      return apiFetch<{ data: PricePoint[] }>(`/api/hooks/${address}/pools/${poolId}/price-history?${qs}`, { cache: "no-store" });
    },
    suggestRange: (address: string, poolId: string, params: {
      chainId?: number; currentTick: number; tickSpacing: number; minTick: number; maxTick: number;
    }) => {
      const qs = new URLSearchParams({
        ...(params.chainId != null ? { chainId: String(params.chainId) } : {}),
        currentTick: String(params.currentTick),
        tickSpacing: String(params.tickSpacing),
        minTick: String(params.minTick),
        maxTick: String(params.maxTick),
      });
      return apiFetch<SuggestRangeResult>(`/api/hooks/${address}/pools/${poolId}/suggest-range?${qs}`, { cache: "no-store" });
    },
  },
  hooks: {
    list: (params?: Record<string, string | number>) => {
      const qs = params ? "?" + new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
        )
      ) : "";
      return apiFetch<PaginatedHooks>(`/api/hooks${qs}`);
    },
    get: (address: string, chainId?: number) => {
      const qs = chainId ? `?chainId=${chainId}` : "";
      return apiFetch<HookDetail>(`/api/hooks/${address}${qs}`);
    },
    source: (address: string) =>
      apiFetch<{ isVerified: boolean; sourceFiles: Array<{ name: string; content: string; language: string }> }>(
        `/api/hooks/${address}/source`
      ),
    security: (address: string) =>
      apiFetch<{ hookScore: number; riskLevel: string; flags: SecurityFlag[] }>(
        `/api/hooks/${address}/security`
      ),
    pools: (address: string, page = 1) =>
      apiFetch<{ data: SwapPool[]; total: number }>(`/api/hooks/${address}/pools?page=${page}`),
    compare: (addresses: string[]) =>
      apiFetch<HookDetail[]>(`/api/hooks/compare?addresses=${addresses.join(",")}`),
  },
  swap: {
    quote: (params: { chainId: number; poolKey: PoolKeyInput; zeroForOne: boolean; amountIn: string }) => {
      const qs = new URLSearchParams({
        chainId: String(params.chainId),
        currency0: params.poolKey.currency0,
        currency1: params.poolKey.currency1,
        fee: String(params.poolKey.fee),
        tickSpacing: String(params.poolKey.tickSpacing),
        hooks: params.poolKey.hooks,
        zeroForOne: String(params.zeroForOne),
        amountIn: params.amountIn,
      });
      return apiFetch<SwapQuote>(`/api/swap/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: {
      chainId: number; poolKey: PoolKeyInput; zeroForOne: boolean; amountIn: string; minAmountOut: string;
    }) =>
      apiFetch<SwapBuildResult>("/api/swap/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  lp: {
    quote: (params: {
      chainId: number; poolKey: PoolKeyInput; tickLower: number; tickUpper: number;
      amount0?: string; amount1?: string;
    }) => {
      const qs = new URLSearchParams({
        chainId: String(params.chainId),
        currency0: params.poolKey.currency0,
        currency1: params.poolKey.currency1,
        fee: String(params.poolKey.fee),
        tickSpacing: String(params.poolKey.tickSpacing),
        hooks: params.poolKey.hooks,
        tickLower: String(params.tickLower),
        tickUpper: String(params.tickUpper),
        ...(params.amount0 ? { amount0: params.amount0 } : {}),
        ...(params.amount1 ? { amount1: params.amount1 } : {}),
      });
      return apiFetch<LpQuoteResult>(`/api/lp/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: {
      chainId: number; poolKey: PoolKeyInput; tickLower: number; tickUpper: number;
      amount0: string; amount1: string; recipient: string; slippageBps?: number; deadlineSeconds?: number;
    }) =>
      apiFetch<LpBuildResult>("/api/lp/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  solanaLp: {
    quote: (params: {
      whirlpoolAddress: string; tickLower: number; tickUpper: number;
      amountA?: string; amountB?: string;
    }) => {
      const qs = new URLSearchParams({
        whirlpoolAddress: params.whirlpoolAddress,
        tickLower: String(params.tickLower),
        tickUpper: String(params.tickUpper),
        ...(params.amountA ? { amountA: params.amountA } : {}),
        ...(params.amountB ? { amountB: params.amountB } : {}),
      });
      return apiFetch<SolanaLpQuoteResult>(`/api/solana-lp/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: {
      whirlpoolAddress: string; tickLower: number; tickUpper: number;
      amountA: string; amountB: string; owner: string; slippageBps?: number;
    }) =>
      apiFetch<SolanaLpBuildResult>("/api/solana-lp/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  orcaSwap: {
    quote: (params: { whirlpoolAddress: string; inputMint: string; amountIn: string; slippageBps?: number }) => {
      const qs = new URLSearchParams({
        whirlpoolAddress: params.whirlpoolAddress,
        inputMint: params.inputMint,
        amountIn: params.amountIn,
        ...(params.slippageBps != null ? { slippageBps: String(params.slippageBps) } : {}),
      });
      return apiFetch<SolanaSwapQuoteResult>(`/api/orca-swap/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: { whirlpoolAddress: string; inputMint: string; amountIn: string; slippageBps?: number; owner: string }) =>
      apiFetch<SolanaSwapBuildResult>("/api/orca-swap/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  raydiumLp: {
    quote: (params: {
      poolId: string; tickLower: number; tickUpper: number; amountA?: string; amountB?: string;
    }) => {
      const qs = new URLSearchParams({
        poolId: params.poolId,
        tickLower: String(params.tickLower),
        tickUpper: String(params.tickUpper),
        ...(params.amountA ? { amountA: params.amountA } : {}),
        ...(params.amountB ? { amountB: params.amountB } : {}),
      });
      return apiFetch<SolanaLpQuoteResult>(`/api/raydium-lp/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: {
      poolId: string; tickLower: number; tickUpper: number; amountA: string; amountB: string; owner: string; slippageBps?: number;
    }) =>
      apiFetch<SolanaLpBuildResult>("/api/raydium-lp/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  raydiumSwap: {
    quote: (params: { poolId: string; inputMint: string; amountIn: string; slippageBps?: number }) => {
      const qs = new URLSearchParams({
        poolId: params.poolId,
        inputMint: params.inputMint,
        amountIn: params.amountIn,
      });
      return apiFetch<SolanaSwapQuoteResult>(`/api/raydium-swap/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: { poolId: string; inputMint: string; amountIn: string; slippageBps?: number; owner: string }) =>
      apiFetch<SolanaSwapBuildResult>("/api/raydium-swap/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  raydiumAmmLp: {
    quote: (params: { poolId: string; amountA?: string; amountB?: string }) => {
      const qs = new URLSearchParams({
        poolId: params.poolId,
        ...(params.amountA ? { amountA: params.amountA } : {}),
        ...(params.amountB ? { amountB: params.amountB } : {}),
      });
      return apiFetch<SimpleLpQuoteResult>(`/api/raydium-amm-lp/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: { poolId: string; amountA: string; amountB: string; owner: string; slippageBps?: number }) =>
      apiFetch<SimpleLpBuildResult>("/api/raydium-amm-lp/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  raydiumAmmSwap: {
    quote: (params: { poolId: string; inputMint: string; amountIn: string; slippageBps?: number }) => {
      const qs = new URLSearchParams({
        poolId: params.poolId,
        inputMint: params.inputMint,
        amountIn: params.amountIn,
        ...(params.slippageBps != null ? { slippageBps: String(params.slippageBps) } : {}),
      });
      return apiFetch<SolanaSwapQuoteResult>(`/api/raydium-amm-swap/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: { poolId: string; inputMint: string; amountIn: string; slippageBps?: number; owner: string }) =>
      apiFetch<SolanaSwapBuildResult>("/api/raydium-amm-swap/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  raydiumCpmmLp: {
    quote: (params: { poolId: string; amountA?: string; amountB?: string }) => {
      const qs = new URLSearchParams({
        poolId: params.poolId,
        ...(params.amountA ? { amountA: params.amountA } : {}),
        ...(params.amountB ? { amountB: params.amountB } : {}),
      });
      return apiFetch<SimpleLpQuoteResult>(`/api/raydium-cpmm-lp/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: { poolId: string; amountA: string; amountB: string; owner: string; slippageBps?: number }) =>
      apiFetch<SimpleLpBuildResult>("/api/raydium-cpmm-lp/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  raydiumCpmmSwap: {
    quote: (params: { poolId: string; inputMint: string; amountIn: string; slippageBps?: number }) => {
      const qs = new URLSearchParams({
        poolId: params.poolId,
        inputMint: params.inputMint,
        amountIn: params.amountIn,
        ...(params.slippageBps != null ? { slippageBps: String(params.slippageBps) } : {}),
      });
      return apiFetch<SolanaSwapQuoteResult>(`/api/raydium-cpmm-swap/quote?${qs}`, { cache: "no-store" });
    },
    build: (body: { poolId: string; inputMint: string; amountIn: string; slippageBps?: number; owner: string }) =>
      apiFetch<SolanaSwapBuildResult>("/api/raydium-cpmm-swap/build", {
        method: "POST",
        body: JSON.stringify(body),
        cache: "no-store",
      }),
  },
  search: {
    query: (q: string, limit = 10) =>
      apiFetch<{ query: string; results: HookSummary[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    suggestions: (q: string) =>
      apiFetch<Array<{ address: string; name: string | null; chainId: number }>>(
        `/api/search/suggestions?q=${encodeURIComponent(q)}`
      ),
  },
  stats: {
    global: () => apiFetch<GlobalStats>("/api/stats"),
  },
};
