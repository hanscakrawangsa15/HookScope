/**
 * Volume & LP Indexer
 *
 * Indexes PoolManager Swap and ModifyLiquidity events to calculate:
 * - Volume 24h / 7d / 30d per hook
 * - Unique LP count per hook
 * - Swap count per hook
 *
 * Uses DeFiLlama token prices for USD conversion.
 *
 * Run: pnpm --filter @hookscope/indexer volume
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { createPublicClient, http, type Address, type Log } from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import { PrismaClient } from "@prisma/client";
import { POOL_MANAGER_ADDRESSES } from "@hookscope/shared";

// ─── Event topics ──────────────────────────────────────────────────────────────

// keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
const SWAP_TOPIC = "0x40e9cecb9f5f1f1ef4b1a2942c482e5d5c4f568f426a64a816f990e0e72e82f";

// keccak256("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)")
const MODIFY_LIQUIDITY_TOPIC = "0x14aedb9fb9d58e4e3ac4df3a56f4a7ca44ef55a4ee7ab0e2aade66c9dbc2a5c6";

// One block ≈ 12s → blocks per day ≈ 7200
const BLOCKS_PER_DAY = 7200n;
const BLOCKS_7D  = 7200n * 7n;
const BLOCKS_30D = 7200n * 30n;
const CHUNK = 2000n;

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl?: string;
  chain: typeof mainnet;
  pmAddress: Address;
  blocksPerDay: bigint;
}

const CHAIN_CONFIGS: ChainConfig[] = [
  { chainId: 1,     name: "Ethereum", rpcUrl: process.env.ETHEREUM_RPC_URL, chain: mainnet,  pmAddress: POOL_MANAGER_ADDRESSES[1]  as Address, blocksPerDay: 7200n },
  { chainId: 8453,  name: "Base",     rpcUrl: process.env.BASE_RPC_URL,     chain: base,     pmAddress: POOL_MANAGER_ADDRESSES[8453] as Address, blocksPerDay: 43200n },
  { chainId: 42161, name: "Arbitrum", rpcUrl: process.env.ARBITRUM_RPC_URL, chain: arbitrum, pmAddress: POOL_MANAGER_ADDRESSES[42161] as Address, blocksPerDay: 345600n },
];

// ─── ERC-20 decimals cache ────────────────────────────────────────────────────

const decimalsCache = new Map<string, number>();

const ERC20_DECIMALS_ABI = [
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

async function getTokenDecimals(
  client: ReturnType<typeof createPublicClient>,
  token: string,
  chainId: number,
): Promise<number> {
  const ZERO = "0x0000000000000000000000000000000000000000";
  const lower = token.toLowerCase();
  // ETH / WETH / native — always 18
  if (lower === ZERO || lower === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") return 18;

  const key = `${chainId}:${lower}`;
  if (decimalsCache.has(key)) return decimalsCache.get(key)!;

  try {
    const dec = await client.readContract({
      address: lower as `0x${string}`,
      abi: ERC20_DECIMALS_ABI,
      functionName: "decimals",
    });
    decimalsCache.set(key, Number(dec));
    return Number(dec);
  } catch {
    decimalsCache.set(key, 18); // safe default
    return 18;
  }
}

// ─── Safe BigInt → USD conversion ────────────────────────────────────────────

/**
 * Converts a token amount (as BigInt, in raw units) to USD.
 *
 * Uses BigInt integer division to avoid float precision loss for large amounts.
 * priceUsd is scaled to 8 decimal places to preserve precision.
 * Caps output at $10B per swap — anything larger is almost certainly a decode error.
 */
function bigintAmountToUsd(amount: bigint, decimals: number, priceUsd: number): number {
  if (priceUsd <= 0 || amount === 0n) return 0;

  // Scale price to avoid fractional cents (price * 10^8 gives sub-cent precision)
  const PRICE_SCALE = 8;
  const scaledPrice = BigInt(Math.round(priceUsd * 10 ** PRICE_SCALE));
  const divisor = 10n ** BigInt(decimals + PRICE_SCALE);

  // amount * scaledPrice / 10^(decimals + PRICE_SCALE) = USD value
  const usdBigInt = amount * scaledPrice / divisor;

  const result = Number(usdBigInt);

  // Sanity cap: $10B per single swap — larger values are bogus
  return Math.min(result, 10_000_000_000);
}

// ─── ABI int128 decoder ───────────────────────────────────────────────────────

/**
 * Decodes an int128 that was ABI-encoded into a 32-byte (256-bit) slot.
 * ABI encoding sign-extends the 128-bit value to 256 bits.
 * To check sign: look at bit 255 (the MSB of the 256-bit word), NOT bit 127.
 */
function decodeInt128(raw256: bigint): bigint {
  // MSB of 256-bit ABI word indicates sign
  const SIGN_BIT = 2n ** 255n;
  const TWO_256  = 2n ** 256n;
  if (raw256 >= SIGN_BIT) {
    // Negative: two's complement convert from 256-bit to signed
    return raw256 - TWO_256;
  }
  return raw256;
}

// ─── DeFiLlama price cache ────────────────────────────────────────────────────

const priceCache = new Map<string, number>();

async function getTokenPrice(chainId: number, token: string): Promise<number> {
  const ZERO = "0x0000000000000000000000000000000000000000";
  const chainPfx: Record<number, string> = { 1: "ethereum", 8453: "base", 42161: "arbitrum", 10: "optimism" };

  let key: string;
  if (token.toLowerCase() === ZERO || token.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
    key = "coingecko:ethereum";
  } else {
    key = `${chainPfx[chainId] ?? "ethereum"}:${token.toLowerCase()}`;
  }

  const cached = priceCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${key}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as { coins: Record<string, { price: number }> };
    const price = data.coins?.[key]?.price ?? 0;
    priceCache.set(key, price);
    return price;
  } catch {
    priceCache.set(key, 0);
    return 0;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function indexChainVolume(cc: ChainConfig, prisma: PrismaClient): Promise<void> {
  if (!cc.rpcUrl) return;

  const client = createPublicClient({
    chain: cc.chain,
    transport: http(cc.rpcUrl, { retryCount: 2 }),
  });

  const latestBlock = await client.getBlockNumber();
  const from7d  = latestBlock - cc.blocksPerDay * 7n;
  const from30d = latestBlock - cc.blocksPerDay * 30n;

  console.log(`\n[${cc.name}] Scanning swap events for volume data...`);
  console.log(`[${cc.name}] Latest: ${latestBlock} | 7d start: ${from7d}`);

  // Build pool→hook lookup from DB
  const pools = await prisma.pool.findMany({
    where: { chainId: cc.chainId },
    select: { poolId: true, hookId: true, token0: true, token1: true },
  });
  const poolToHook = new Map<string, { hookId: string; token0: string; token1: string }>();
  for (const p of pools) {
    poolToHook.set(p.poolId.toLowerCase(), { hookId: p.hookId, token0: p.token0, token1: p.token1 });
  }

  console.log(`[${cc.name}] Loaded ${poolToHook.size} pool→hook mappings`);

  // Pre-fetch and cache token decimals for all pools upfront.
  const allTokens = new Set<string>();
  for (const p of pools) {
    allTokens.add(p.token0.toLowerCase());
    allTokens.add(p.token1.toLowerCase());
  }
  console.log(`[${cc.name}] Pre-fetching decimals for ${allTokens.size} tokens...`);
  for (const token of allTokens) {
    await getTokenDecimals(client, token, cc.chainId);
    await sleep(50);
  }

  // Accumulators: hookId → {vol7d, vol30d, swaps, lpSet}
  type HookStats = { vol7d: number; vol30d: number; swaps: number; lps: Set<string> };
  const stats = new Map<string, HookStats>();

  const getOrCreate = (hookId: string): HookStats => {
    if (!stats.has(hookId)) stats.set(hookId, { vol7d: 0, vol30d: 0, swaps: 0, lps: new Set() });
    return stats.get(hookId)!;
  };

  // ── Scan Swap events (30d) ─────────────────────────────────────────────────
  let swapEvents = 0;
  let current = from30d < 0n ? 0n : from30d;

  while (current <= latestBlock) {
    const toBlock = current + CHUNK - 1n < latestBlock ? current + CHUNK - 1n : latestBlock;

    try {
      const logs = await client.getLogs({
        address: cc.pmAddress,
        topics: [SWAP_TOPIC as `0x${string}`],
        fromBlock: current,
        toBlock,
      });

      for (const log of logs) {
        swapEvents++;
        const poolId = (log.topics[1] as string)?.toLowerCase();
        if (!poolId) continue;

        const pool = poolToHook.get(poolId);
        if (!pool) continue;

        const st = getOrCreate(pool.hookId);
        st.swaps++;

        // Parse swap amounts from data: amount0(int128) + amount1(int128) + ...
        // ABI encoding pads each value to a full 32-byte (256-bit) slot, sign-extended.
        if (log.data && log.data.length >= 66) {
          const data = log.data.slice(2);
          const raw0 = BigInt("0x" + data.slice(0, 64));
          const raw1 = BigInt("0x" + data.slice(64, 128));

          // Decode sign-extended 256-bit ABI slots to signed int128 values.
          // Must check bit-255 (256-bit MSB), not bit-127.
          const amount0 = decodeInt128(raw0);
          const amount1 = decodeInt128(raw1);

          const absAmt0 = amount0 < 0n ? -amount0 : amount0;
          const absAmt1 = amount1 < 0n ? -amount1 : amount1;

          // Get prices and actual token decimals (both cached)
          const t0key = `${cc.chainId}:${pool.token0.toLowerCase()}`;
          const t1key = `${cc.chainId}:${pool.token1.toLowerCase()}`;
          const [p0, p1] = await Promise.all([
            getTokenPrice(cc.chainId, pool.token0),
            getTokenPrice(cc.chainId, pool.token1),
          ]);
          const dec0 = decimalsCache.get(t0key) ?? 18;
          const dec1 = decimalsCache.get(t1key) ?? 18;

          // Use whichever side has a known price (avoids double-counting).
          // bigintAmountToUsd uses real decimals and caps at $10B per swap.
          const vol = p0 > 0
            ? bigintAmountToUsd(absAmt0, dec0, p0)
            : p1 > 0
            ? bigintAmountToUsd(absAmt1, dec1, p1)
            : 0;

          // Add to 30d; also 7d if within range
          st.vol30d += vol;
          if (log.blockNumber && log.blockNumber >= from7d) {
            st.vol7d += vol;
          }
        }
      }
    } catch {
      // Skip failed chunks
    }

    current = toBlock + 1n;
  }

  console.log(`[${cc.name}] Swap events scanned: ${swapEvents}`);

  // ── Scan ModifyLiquidity events (30d) ─────────────────────────────────────
  let lpEvents = 0;
  current = from30d < 0n ? 0n : from30d;

  while (current <= latestBlock) {
    const toBlock = current + CHUNK - 1n < latestBlock ? current + CHUNK - 1n : latestBlock;

    try {
      const logs = await client.getLogs({
        address: cc.pmAddress,
        topics: [MODIFY_LIQUIDITY_TOPIC as `0x${string}`],
        fromBlock: current,
        toBlock,
      });

      for (const log of logs) {
        lpEvents++;
        const poolId = (log.topics[1] as string)?.toLowerCase();
        const sender  = (log.topics[2] as string);
        if (!poolId || !sender) continue;

        const pool = poolToHook.get(poolId);
        if (!pool) continue;

        const st = getOrCreate(pool.hookId);
        st.lps.add(sender.toLowerCase());
      }
    } catch {
      // Skip
    }

    current = toBlock + 1n;
  }

  console.log(`[${cc.name}] LP events scanned: ${lpEvents}`);

  // ── Persist to DB ─────────────────────────────────────────────────────────
  let saved = 0;
  for (const [hookId, st] of stats) {
    await prisma.hookAnalytics.upsert({
      where: { hookId },
      create: {
        hookId,
        volume7dUsd: st.vol7d,
        volume30dUsd: st.vol30d,
        swapCount: BigInt(st.swaps),
        uniqueLps: st.lps.size,
        updatedAt: new Date(),
      },
      update: {
        volume7dUsd: st.vol7d,
        volume30dUsd: st.vol30d,
        swapCount: BigInt(st.swaps),
        uniqueLps: st.lps.size,
        updatedAt: new Date(),
      },
    });
    saved++;
  }

  console.log(`[${cc.name}] ✅ Saved volume data for ${saved} hooks`);
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  console.log("HookScope Volume Indexer");
  console.log("Scanning Swap + ModifyLiquidity events...\n");

  for (const cc of CHAIN_CONFIGS) {
    try {
      await indexChainVolume(cc, prisma);
    } catch (err) {
      console.error(`[${cc.name}] Error:`, err);
    }
  }

  // Print final summary
  const [vol, topByVol] = await Promise.all([
    prisma.hookAnalytics.aggregate({
      _sum: { volume7dUsd: true, volume30dUsd: true, swapCount: true },
    }),
    prisma.hookAnalytics.findMany({
      where: { volume7dUsd: { gt: 0 } },
      orderBy: { volume7dUsd: "desc" },
      take: 5,
      include: { hook: { select: { address: true, name: true } } },
    }),
  ]);

  console.log("\n=== Volume Summary ===");
  console.log(`Volume 7d  : $${(vol._sum.volume7dUsd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  console.log(`Volume 30d : $${(vol._sum.volume30dUsd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  console.log(`Total swaps: ${vol._sum.swapCount ?? 0}`);

  if (topByVol.length > 0) {
    console.log("\nTop hooks by 7d volume:");
    topByVol.forEach((a) => {
      const name = a.hook.name ?? a.hook.address.slice(0, 14) + "...";
      console.log(`  ${name}: $${a.volume7dUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
    });
  }

  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch(console.error);
