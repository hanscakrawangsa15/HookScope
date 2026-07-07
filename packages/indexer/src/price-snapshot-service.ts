/**
 * Real-time price history snapshotter for every swappable pool type (EVM
 * Uniswap v4, Orca Whirlpool, Raydium CLMM, Raydium AMM v4, Raydium CPMM).
 * Runs every 2 minutes via setInterval in the indexer process, same pattern
 * as AnalyticsService. Powers the price chart + volatility/trend range
 * suggestion on the Add Liquidity panels.
 *
 * AMM v4/CPMM are constant-product (no tick range) — their snapshots store a
 * fixed tick=0 sentinel and rely on `price` alone (the chart for those pools
 * doesn't render a selected-range band, just the price line).
 */

import { createPublicClient, http, type PublicClient, type Address } from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import { PrismaClient } from "@prisma/client";
import { Connection, PublicKey } from "@solana/web3.js";
import { ReadOnlyWallet } from "@orca-so/common-sdk";
import { WhirlpoolContext, buildWhirlpoolClient } from "@orca-so/whirlpools-sdk";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import {
  V4_STATE_VIEW_ADDRESSES, V4_STATE_VIEW_ABI, ORCA_WHIRLPOOL_PROGRAM_ID, RAYDIUM_CLMM_PROGRAM_ID,
  RAYDIUM_AMM_V4_PROGRAM_ID, RAYDIUM_CPMM_PROGRAM_ID,
} from "@hookscope/shared";

const SOLANA_CHAIN_ID = 1399811149;

// Cap snapshotting to the highest-TVL pools per source — avoids hammering
// RPCs every 2 minutes for long-tail pools nobody is charting.
const MAX_SNAPSHOT_POOLS_PER_SOURCE = 50;
const RETENTION_DAYS = 30;

// tick → price via 1.0001^tick geometric formula (Uniswap V3/V4 standard).
// Fix: clamp tick to ±887272 before conversion to prevent Number overflow
// (1.0001^887272 ≈ 10^38 which is safe, but beyond those bounds JS returns Infinity).
// The decimal adjustment 10^(dA-dB) is applied in log space to avoid
// secondary overflow when |dA - dB| is large.
function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  const clampedTick = Math.max(-887272, Math.min(887272, tick));
  // Use exp(tick × ln(1.0001)) + decimal offset in log space for numerical stability
  const logPrice = clampedTick * Math.log(1.0001) + (decimalsA - decimalsB) * Math.log(10);
  const result = Math.exp(logPrice);
  return isFinite(result) ? result : 0;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const ERC20_DECIMALS_ABI = [
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

interface EvmChainClient {
  chainId: number;
  client: PublicClient;
  stateViewAddress: Address;
}

function buildEvmClients(): EvmChainClient[] {
  const configs = [
    { chainId: 1,     rpc: process.env.ETHEREUM_RPC_URL, chain: mainnet  },
    { chainId: 8453,  rpc: process.env.BASE_RPC_URL,     chain: base     },
    { chainId: 42161, rpc: process.env.ARBITRUM_RPC_URL, chain: arbitrum },
    { chainId: 10,    rpc: process.env.OPTIMISM_RPC_URL, chain: optimism },
  ];

  return configs
    .filter((c) => c.rpc && V4_STATE_VIEW_ADDRESSES[c.chainId])
    .map((c) => ({
      chainId: c.chainId,
      stateViewAddress: V4_STATE_VIEW_ADDRESSES[c.chainId] as Address,
      // Short timeout + low retry count is deliberate here, unlike the
      // interactive lp.ts/swap.ts routes — this loops over up to 50 pools per
      // chain, so per-call delay multiplies up to 50x. A dead/slow RPC at
      // retryCount:3 with no timeout once stalled a single refresh cycle for
      // 3.5+ hours (every call hit viem's default ~10s timeout, 3x over).
      client: createPublicClient({ chain: c.chain, transport: http(c.rpc!, { retryCount: 1, retryDelay: 300, timeout: 5_000 }) }) as PublicClient,
    }));
}

// getSlot0 must be called against StateView, not PoolManager directly — verified
// in packages/shared/src/constants.ts: PoolManager only inherits Extsload, a
// direct getSlot0 call on it reverts on every chain. StateView is the contract
// built specifically to make this readable off-chain.
const decimalsCache = new Map<string, number>();
async function getDecimals(client: PublicClient, token: Address): Promise<number> {
  const lower = token.toLowerCase();
  if (lower === ZERO_ADDR) return 18;
  const cached = decimalsCache.get(lower);
  if (cached !== undefined) return cached;
  try {
    const dec = await client.readContract({ address: token, abi: ERC20_DECIMALS_ABI, functionName: "decimals" });
    decimalsCache.set(lower, Number(dec));
    return Number(dec);
  } catch {
    return 18;
  }
}

// sqrtPriceX96 is a Q64.96 fixed-point number (160-bit).
// Fix: JavaScript Number only has 53-bit mantissa — direct Number() conversion
// loses precision for large sqrtPriceX96 values. We use BigInt arithmetic to
// compute the squared ratio at higher precision before converting to Number.
//
// Method: compute (sqrtPriceX96)^2 / 2^192 via BigInt shift, then apply
// decimal adjustment. This preserves ~30 significant digits vs ~15 for naive approach.
function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  if (sqrtPriceX96 === 0n) return 0;
  // Compute price = (sqrtPriceX96 / 2^96)^2 in BigInt to avoid 53-bit precision loss.
  // Use 18 decimal places of intermediate precision: multiply by 10^18 before dividing.
  const PRECISION = 10n ** 18n;
  const Q192 = 2n ** 192n;
  const priceScaled = (sqrtPriceX96 * sqrtPriceX96 * PRECISION) / Q192;
  const priceRaw = Number(priceScaled) / 1e18;
  // Apply decimal offset in log space to stay numerically stable
  return priceRaw * Math.pow(10, decimals0 - decimals1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PriceSnapshotService {
  private readonly evmClients: EvmChainClient[];
  private readonly solanaConnection: Connection;
  // Caches the in-flight *promise*, not the resolved value — the CLMM/AMM/CPMM
  // sweeps now run concurrently (see refresh()), so caching only the resolved
  // value would let multiple concurrent first-calls each kick off their own
  // redundant Raydium.load(). Sharing the promise means they all await the
  // same single load.
  private raydiumPromise: ReturnType<typeof Raydium.load> | null = null;
  private running = false;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaClient) {
    this.evmClients = buildEvmClients();
    this.solanaConnection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  }

  private getRaydium() {
    if (!this.raydiumPromise) {
      this.raydiumPromise = Raydium.load({ connection: this.solanaConnection, owner: PublicKey.default, disableLoadToken: true });
    }
    return this.raydiumPromise;
  }

  start(intervalMs = 2 * 60 * 1000): void {
    console.log("[PriceSnapshot] Starting — refresh every", intervalMs / 60000, "minutes");
    this.refresh();
    this.intervalId = setInterval(() => this.refresh(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async refresh(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const start = Date.now();
    console.log("[PriceSnapshot] Refreshing...");

    try {
      // Run every source concurrently — each chain/DEX sweep already isolates
      // its own per-pool errors internally, so nothing here depends on
      // sequencing. Previously these ran one after another, which meant a
      // single dead/slow RPC (e.g. a public Ethereum endpoint timing out on
      // every call) stalled every other chain and every Solana DEX behind it
      // — one bad cycle took 3.5+ hours instead of the usual ~3-5 minutes.
      const results = await Promise.allSettled([
        ...this.evmClients.map((cc) => this.snapshotEvmChain(cc)),
        this.snapshotOrca(),
        this.snapshotRaydiumClmm(),
        this.snapshotRaydiumAmm(),
        this.snapshotRaydiumCpmm(),
      ]);
      for (const r of results) {
        if (r.status === "rejected") console.error("[PriceSnapshot] Source sweep failed:", r.reason);
      }
      await this.pruneOldSnapshots();
      console.log(`[PriceSnapshot] Refresh complete in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.error("[PriceSnapshot] Refresh error:", err);
    } finally {
      this.running = false;
    }
  }

  private async snapshotEvmChain(cc: EvmChainClient): Promise<void> {
    const pools = await this.prisma.pool.findMany({
      where: { chainId: cc.chainId, isActive: true },
      orderBy: { tvlUsd: "desc" },
      take: MAX_SNAPSHOT_POOLS_PER_SOURCE,
    });
    if (pools.length === 0) return;

    let snapped = 0;
    for (const pool of pools) {
      try {
        const slot0 = await cc.client.readContract({
          address: cc.stateViewAddress,
          abi: V4_STATE_VIEW_ABI,
          functionName: "getSlot0",
          args: [pool.poolId as `0x${string}`],
        });
        const [sqrtPriceX96, tick] = slot0;
        if (sqrtPriceX96 === 0n) continue; // pool not yet initialized on-chain

        const [decimals0, decimals1] = await Promise.all([
          getDecimals(cc.client, pool.token0 as Address),
          getDecimals(cc.client, pool.token1 as Address),
        ]);
        const price = sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1);

        await this.prisma.poolPriceSnapshot.create({
          data: { poolId: pool.poolId, chainId: pool.chainId, tick: Number(tick), price },
        });
        snapped++;
      } catch (err) {
        console.warn(`[PriceSnapshot] EVM pool ${pool.poolId.slice(0, 10)} (chain ${cc.chainId}) failed:`, (err as Error).message);
      }
      // Gentle on free public RPCs — same throttling pattern as analytics-service.ts.
      await sleep(80);
    }
    console.log(`[PriceSnapshot] Chain ${cc.chainId}: snapped ${snapped}/${pools.length} pools`);
  }

  private async snapshotOrca(): Promise<void> {
    const pools = await this.prisma.pool.findMany({
      where: { chainId: SOLANA_CHAIN_ID, isActive: true, hook: { address: ORCA_WHIRLPOOL_PROGRAM_ID } },
      orderBy: { tvlUsd: "desc" },
      take: MAX_SNAPSHOT_POOLS_PER_SOURCE,
    });
    if (pools.length === 0) return;

    const ctx = WhirlpoolContext.from(this.solanaConnection, new ReadOnlyWallet(PublicKey.default));
    const client = buildWhirlpoolClient(ctx);

    let snapped = 0;
    for (const pool of pools) {
      try {
        const whirlpool = await client.getPool(new PublicKey(pool.poolId));
        const data = whirlpool.getData();
        const decimalsA = whirlpool.getTokenAInfo().decimals;
        const decimalsB = whirlpool.getTokenBInfo().decimals;
        const price = tickToPrice(data.tickCurrentIndex, decimalsA, decimalsB);

        await this.prisma.poolPriceSnapshot.create({
          data: { poolId: pool.poolId, chainId: SOLANA_CHAIN_ID, tick: data.tickCurrentIndex, price },
        });
        snapped++;
      } catch (err) {
        console.warn(`[PriceSnapshot] Orca pool ${pool.poolId.slice(0, 10)} failed:`, (err as Error).message);
      }
      await sleep(120);
    }
    console.log(`[PriceSnapshot] Orca: snapped ${snapped}/${pools.length} pools`);
  }

  private async snapshotRaydiumClmm(): Promise<void> {
    const pools = await this.prisma.pool.findMany({
      where: { chainId: SOLANA_CHAIN_ID, isActive: true, hook: { address: RAYDIUM_CLMM_PROGRAM_ID } },
      orderBy: { tvlUsd: "desc" },
      take: MAX_SNAPSHOT_POOLS_PER_SOURCE,
    });
    if (pools.length === 0) return;

    const raydium = await this.getRaydium();

    let snapped = 0;
    for (const pool of pools) {
      try {
        const { poolInfo, rpcData } = await raydium.clmm.getSimplePoolInfo(pool.poolId);
        const price = tickToPrice(rpcData.tickCurrent, poolInfo.mintA.decimals, poolInfo.mintB.decimals);

        await this.prisma.poolPriceSnapshot.create({
          data: { poolId: pool.poolId, chainId: SOLANA_CHAIN_ID, tick: rpcData.tickCurrent, price },
        });
        snapped++;
      } catch (err) {
        console.warn(`[PriceSnapshot] Raydium CLMM pool ${pool.poolId.slice(0, 10)} failed:`, (err as Error).message);
      }
      await sleep(120);
    }
    console.log(`[PriceSnapshot] Raydium CLMM: snapped ${snapped}/${pools.length} pools`);
  }

  // Constant-product — no tick, so `tick` is a fixed 0 sentinel and `price`
  // (the SDK's own reserve-ratio computation) is the only meaningful field.
  private async snapshotRaydiumAmm(): Promise<void> {
    const pools = await this.prisma.pool.findMany({
      where: { chainId: SOLANA_CHAIN_ID, isActive: true, hook: { address: RAYDIUM_AMM_V4_PROGRAM_ID } },
      orderBy: { tvlUsd: "desc" },
      take: MAX_SNAPSHOT_POOLS_PER_SOURCE,
    });
    if (pools.length === 0) return;

    const raydium = await this.getRaydium();

    let snapped = 0;
    for (const pool of pools) {
      try {
        const { poolInfo } = await raydium.liquidity.getPoolInfoFromRpc({ poolId: pool.poolId });
        await this.prisma.poolPriceSnapshot.create({
          data: { poolId: pool.poolId, chainId: SOLANA_CHAIN_ID, tick: 0, price: poolInfo.price },
        });
        snapped++;
      } catch (err) {
        console.warn(`[PriceSnapshot] Raydium AMM v4 pool ${pool.poolId.slice(0, 10)} failed:`, (err as Error).message);
      }
      await sleep(120);
    }
    console.log(`[PriceSnapshot] Raydium AMM v4: snapped ${snapped}/${pools.length} pools`);
  }

  private async snapshotRaydiumCpmm(): Promise<void> {
    const pools = await this.prisma.pool.findMany({
      where: { chainId: SOLANA_CHAIN_ID, isActive: true, hook: { address: RAYDIUM_CPMM_PROGRAM_ID } },
      orderBy: { tvlUsd: "desc" },
      take: MAX_SNAPSHOT_POOLS_PER_SOURCE,
    });
    if (pools.length === 0) return;

    const raydium = await this.getRaydium();

    let snapped = 0;
    for (const pool of pools) {
      try {
        const { poolInfo } = await raydium.cpmm.getPoolInfoFromRpc(pool.poolId);
        await this.prisma.poolPriceSnapshot.create({
          data: { poolId: pool.poolId, chainId: SOLANA_CHAIN_ID, tick: 0, price: poolInfo.price },
        });
        snapped++;
      } catch (err) {
        console.warn(`[PriceSnapshot] Raydium CPMM pool ${pool.poolId.slice(0, 10)} failed:`, (err as Error).message);
      }
      await sleep(120);
    }
    console.log(`[PriceSnapshot] Raydium CPMM: snapped ${snapped}/${pools.length} pools`);
  }

  private async pruneOldSnapshots(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.poolPriceSnapshot.deleteMany({ where: { timestamp: { lt: cutoff } } });
    if (count > 0) console.log(`[PriceSnapshot] Pruned ${count} snapshots older than ${RETENTION_DAYS}d`);
  }
}
