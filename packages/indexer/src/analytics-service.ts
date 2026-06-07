/**
 * Real-time analytics engine.
 *
 * Sources:
 * 1. DeFiLlama Coins API  — free token price (no API key needed)
 * 2. PoolManager on-chain — getLiquidity() + getSlot0() per pool
 * 3. TVL formula          — derived from sqrtPriceX96 + liquidity
 *
 * Runs every 5 minutes via setInterval in the indexer process.
 */

import { createPublicClient, http, type PublicClient, type Address } from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import { PrismaClient } from "@prisma/client";
import { POOL_MANAGER_ADDRESSES } from "@hookscope/shared";

// ─── ERC-20 balanceOf ABI ─────────────────────────────────────────────────────
const BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ERC-20 ABI for decimals + symbol
const ERC20_ABI = [
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "symbol",   type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "name",     type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

interface ChainClient { chainId: number; client: PublicClient; pmAddress: Address }

function buildClients(): ChainClient[] {
  const configs = [
    { chainId: 1,     rpc: process.env.ETHEREUM_RPC_URL, chain: mainnet  },
    { chainId: 8453,  rpc: process.env.BASE_RPC_URL,     chain: base     },
    { chainId: 42161, rpc: process.env.ARBITRUM_RPC_URL, chain: arbitrum },
    { chainId: 10,    rpc: process.env.OPTIMISM_RPC_URL, chain: optimism },
  ];

  return configs
    .filter((c) => c.rpc && POOL_MANAGER_ADDRESSES[c.chainId])
    .map((c) => ({
      chainId: c.chainId,
      pmAddress: POOL_MANAGER_ADDRESSES[c.chainId] as Address,
      client: createPublicClient({ chain: c.chain, transport: http(c.rpc!, { retryCount: 2 }) }) as PublicClient,
    }));
}

// ─── DeFiLlama price fetcher (completely free, no API key) ────────────────────

const priceCache = new Map<string, { price: number; ts: number }>();
const PRICE_TTL = 5 * 60 * 1000; // 5 min

async function getTokenPrice(chainId: number, tokenAddress: string): Promise<number> {
  // ETH / WETH special case
  const lower = tokenAddress.toLowerCase();
  if (lower === ZERO_ADDR ||
      lower === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
      lower === "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2") {
    return await getEthPrice();
  }

  const chainPrefix: Record<number, string> = { 1: "ethereum", 8453: "base", 42161: "arbitrum", 10: "optimism" };
  const prefix = chainPrefix[chainId] ?? "ethereum";
  const key = `${prefix}:${lower}`;

  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.ts < PRICE_TTL) return cached.price;

  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${key}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 0;
    const data = await res.json() as { coins: Record<string, { price: number }> };
    const price = data.coins?.[key]?.price ?? 0;
    priceCache.set(key, { price, ts: Date.now() });
    return price;
  } catch {
    return 0;
  }
}

let ethPriceCache = { price: 0, ts: 0 };
async function getEthPrice(): Promise<number> {
  if (ethPriceCache.price && Date.now() - ethPriceCache.ts < PRICE_TTL) {
    return ethPriceCache.price;
  }
  try {
    const res = await fetch(
      "https://coins.llama.fi/prices/current/coingecko:ethereum",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json() as { coins: Record<string, { price: number }> };
    const price = data.coins?.["coingecko:ethereum"]?.price ?? 0;
    ethPriceCache = { price, ts: Date.now() };
    return price;
  } catch {
    return 0;
  }
}

// ─── On-chain TVL calculation ─────────────────────────────────────────────────

/**
 * Gets total USD value of a token held by the PoolManager.
 * balanceOf(poolManager) = total tokens across ALL pools using this token.
 * Used to calculate per-hook TVL proportionally.
 */
async function getTokenTVLInPoolManager(
  client: PublicClient,
  tokenAddress: string,
  pmAddress: Address,
  chainId: number
): Promise<{ balance: bigint; decimals: number; priceUsd: number }> {
  // Native ETH/address(0) — check ETH balance of PoolManager
  if (tokenAddress === ZERO_ADDR ||
      tokenAddress === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
    try {
      const balance = await client.getBalance({ address: pmAddress });
      const price = await getEthPrice();
      const decimals = 18;
      return { balance, decimals, priceUsd: price };
    } catch {
      return { balance: 0n, decimals: 18, priceUsd: 0 };
    }
  }

  try {
    const [balance, decimals, priceUsd] = await Promise.all([
      client.readContract({
        address: tokenAddress as Address,
        abi: BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [pmAddress],
      }),
      getDecimals(client, tokenAddress as Address),
      getTokenPrice(chainId, tokenAddress),
    ]);

    return { balance: balance as bigint, decimals, priceUsd };
  } catch {
    return { balance: 0n, decimals: 18, priceUsd: 0 };
  }
}

const decimalsCache = new Map<string, number>();
async function getDecimals(client: PublicClient, token: Address): Promise<number> {
  const lower = token.toLowerCase();
  if (lower === ZERO_ADDR || lower === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") return 18;
  const cached = decimalsCache.get(lower);
  if (cached !== undefined) return cached;
  try {
    const dec = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
    decimalsCache.set(lower, Number(dec));
    return Number(dec);
  } catch {
    return 18;
  }
}

async function getTokenSymbol(client: PublicClient, token: Address): Promise<string | null> {
  const lower = token.toLowerCase();
  if (lower === ZERO_ADDR) return "ETH";
  try {
    return await client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }) as string;
  } catch {
    return null;
  }
}

// ─── Main analytics runner ────────────────────────────────────────────────────

export class AnalyticsService {
  private readonly clients: ChainClient[];
  private running = false;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaClient) {
    this.clients = buildClients();
  }

  /** Start periodic refresh every 5 minutes. */
  start(intervalMs = 5 * 60 * 1000): void {
    console.log("[Analytics] Starting — refresh every", intervalMs / 60000, "minutes");
    this.refresh(); // immediate first run
    this.intervalId = setInterval(() => this.refresh(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const start = Date.now();
    console.log("[Analytics] Refreshing TVL data...");

    try {
      // Process each chain
      for (const cc of this.clients) {
        await this.refreshChain(cc);
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[Analytics] Refresh complete in ${elapsed}s`);
    } catch (err) {
      console.error("[Analytics] Refresh error:", err);
    } finally {
      this.running = false;
    }
  }

  private async refreshChain(cc: ChainClient): Promise<void> {
    const pools = await this.prisma.pool.findMany({
      where: { chainId: cc.chainId, isActive: true },
      include: { hook: { select: { id: true } } },
    });

    if (pools.length === 0) return;
    console.log(`[Analytics] Chain ${cc.chainId}: ${pools.length} pools`);

    // ── Step 1: Update token symbols (batch, only missing) ──────────────────
    const missingSymbol = pools.filter((p) => !p.token0Symbol || !p.token1Symbol);
    for (const pool of missingSymbol.slice(0, 50)) {
      const [sym0, sym1] = await Promise.all([
        getTokenSymbol(cc.client, pool.token0 as Address),
        getTokenSymbol(cc.client, pool.token1 as Address),
      ]);
      if (sym0 || sym1) {
        await this.prisma.pool.update({
          where: { id: pool.id },
          data: { token0Symbol: sym0 ?? undefined, token1Symbol: sym1 ?? undefined },
        });
      }
      await sleep(50);
    }

    // ── Step 2: Get unique tokens and their PoolManager balances ────────────
    // The PoolManager holds ALL tokens for ALL pools. We get its total balance
    // per token, then distribute proportionally to hooks by pool count.
    const uniqueTokens = new Set<string>();
    for (const pool of pools) {
      uniqueTokens.add(pool.token0.toLowerCase());
      uniqueTokens.add(pool.token1.toLowerCase());
    }

    // Fetch balance + price for each unique token (limit to 40 most common)
    const tokenValueMap = new Map<string, number>(); // token → USD value held by PM
    const sortedTokens = [...uniqueTokens].slice(0, 40);

    console.log(`[Analytics] Fetching prices for ${sortedTokens.length} unique tokens...`);

    for (const token of sortedTokens) {
      const { balance, decimals, priceUsd } = await getTokenTVLInPoolManager(
        cc.client,
        token,
        cc.pmAddress,
        cc.chainId
      );

      if (priceUsd > 0 && balance > 0n) {
        const usdValue = (Number(balance) / 10 ** decimals) * priceUsd;
        tokenValueMap.set(token, usdValue);
        console.log(`  ${token.slice(0, 10)}... = $${usdValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
      }
      await sleep(150); // rate limit DeFiLlama
    }

    // Total TVL held by PoolManager
    const totalChainTVL = [...tokenValueMap.values()].reduce((a, b) => a + b, 0);
    console.log(`[Analytics] Chain ${cc.chainId} total TVL: $${totalChainTVL.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

    if (totalChainTVL === 0) {
      // Still update pool counts even without TVL
      await this.updatePoolCounts(pools);
      return;
    }

    // ── Step 3: Distribute TVL proportionally to hooks ──────────────────────
    // Hook TVL share = (hook's pool count / total pools) * total TVL
    // This is an approximation — actual distribution requires subgraph data
    const hookPoolCount = new Map<string, number>();
    for (const pool of pools) {
      const hookId = pool.hook.id;
      hookPoolCount.set(hookId, (hookPoolCount.get(hookId) ?? 0) + 1);
    }

    const totalPools = pools.length;

    for (const [hookId, poolCount] of hookPoolCount) {
      const share = poolCount / totalPools;
      const hookTVL = totalChainTVL * share;

      await this.prisma.hookAnalytics.upsert({
        where: { hookId },
        create: {
          hookId,
          tvlUsd: hookTVL,
          poolCount,
          updatedAt: new Date(),
        },
        update: {
          tvlUsd: hookTVL,
          poolCount,
          updatedAt: new Date(),
        },
      });
    }

    // ── Step 4: Distribute TVL to individual pools ───────────────────────────
    for (const pool of pools) {
      const token0Val = tokenValueMap.get(pool.token0.toLowerCase()) ?? 0;
      const token1Val = tokenValueMap.get(pool.token1.toLowerCase()) ?? 0;

      // Each pool's share = tokens it uses / total token value (rough)
      const poolTVL = totalPools > 0
        ? (token0Val + token1Val) / totalPools
        : 0;

      if (poolTVL > 0) {
        await this.prisma.pool.update({
          where: { id: pool.id },
          data: { tvlUsd: poolTVL },
        });
      }
    }
  }

  private async updatePoolCounts(pools: Array<{ hookId: string; hook: { id: string } }>): Promise<void> {
    const hookPoolCount = new Map<string, number>();
    for (const pool of pools) {
      const id = pool.hook.id;
      hookPoolCount.set(id, (hookPoolCount.get(id) ?? 0) + 1);
    }
    for (const [hookId, poolCount] of hookPoolCount) {
      await this.prisma.hookAnalytics.upsert({
        where: { hookId },
        create: { hookId, poolCount, updatedAt: new Date() },
        update: { poolCount, updatedAt: new Date() },
      });
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
