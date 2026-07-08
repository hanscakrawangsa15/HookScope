import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Address } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import { V4_STATE_VIEW_ADDRESSES, RAYDIUM_AMM_V4_PROGRAM_ID, RAYDIUM_CPMM_PROGRAM_ID } from "@hookscope/shared";
import { prisma } from "../db.js";
import { getClient, computePoolId, readDecimals, readLiveState, type PoolKeyInput } from "./lp.js";

export const priceHistoryRouter = new Hono();

const SOLANA_CHAIN_ID = 1399811149;

// EVM addresses are case-insensitive (stored lowercase in DB).
// Solana base58 addresses are case-sensitive — never lowercase them.
function normalizeAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}

// Higher-precision sqrtPriceX96 → price via BigInt intermediate arithmetic.
// Avoids 53-bit mantissa precision loss of direct Number() conversion.
function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  if (sqrtPriceX96 === 0n) return 0;
  const PRECISION = 10n ** 18n;
  const Q192 = 2n ** 192n;
  const priceScaled = (sqrtPriceX96 * sqrtPriceX96 * PRECISION) / Q192;
  return (Number(priceScaled) / 1e18) * Math.pow(10, decimals0 - decimals1);
}

// The indexer's PriceSnapshotService only sweeps the top ~50 pools per chain by
// TVL (to avoid hammering free RPCs every 2 minutes) — most pools never get
// swept. Rather than leave the chart permanently empty for everything outside
// that window, take one real on-chain reading ourselves the first time someone
// actually opens that pool's chart, and persist it so it joins the normal
// history from then on. Best-effort: any failure here just leaves the chart
// empty until the next opportunity, same as before this existed.
async function tryLiveEvmSnapshot(
  chainId: number,
  hookAddress: string,
  pool: { poolId: string; token0: string; token1: string; fee: number; tickSpacing: number },
): Promise<{ tick: number; price: number } | null> {
  const client = getClient(chainId);
  const stateViewAddr = V4_STATE_VIEW_ADDRESSES[chainId];
  if (!client || !stateViewAddr) return null;

  const poolKey: PoolKeyInput = {
    currency0: pool.token0 as Address,
    currency1: pool.token1 as Address,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: hookAddress as Address,
  };
  const poolId = computePoolId(poolKey);
  if (poolId.toLowerCase() !== pool.poolId.toLowerCase()) return null;

  const state = await readLiveState(client, stateViewAddr, poolId);
  if (!state) return null;

  const [decimals0, decimals1] = await Promise.all([
    readDecimals(client, poolKey.currency0),
    readDecimals(client, poolKey.currency1),
  ]);
  return { tick: state.tick, price: sqrtPriceX96ToPrice(state.sqrtPriceX96, decimals0, decimals1) };
}

// Same lazy single-connection pattern as raydium-amm-lp.ts/raydium-cpmm-lp.ts.
let solanaConnection: Connection | null = null;
function getSolanaConnection(): Connection {
  if (!solanaConnection) {
    solanaConnection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
  }
  return solanaConnection;
}

let raydiumLoad: ReturnType<typeof Raydium.load> | null = null;
function getRaydium() {
  if (!raydiumLoad) {
    raydiumLoad = Raydium.load({ connection: getSolanaConnection(), owner: PublicKey.default, disableLoadToken: true });
  }
  return raydiumLoad;
}

// AMM v4 / CPMM are constant-product — no tick concept, so `tick` is a fixed
// sentinel (0, never read back) and `price` (Raydium SDK's own computed
// reserve-ratio price) is the only meaningful field.
async function tryLiveRaydiumSimpleSnapshot(
  dex: "raydium-amm" | "raydium-cpmm",
  poolId: string,
): Promise<{ tick: number; price: number } | null> {
  const raydium = await getRaydium();
  if (dex === "raydium-amm") {
    const { poolInfo } = await raydium.liquidity.getPoolInfoFromRpc({ poolId });
    return { tick: 0, price: poolInfo.price };
  }
  const { poolInfo } = await raydium.cpmm.getPoolInfoFromRpc(poolId);
  return { tick: 0, price: poolInfo.price };
}

function nearestUsableTick(tick: number, tickSpacing: number, minTick: number, maxTick: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  if (rounded < minTick) return Math.ceil(minTick / tickSpacing) * tickSpacing;
  if (rounded > maxTick) return Math.floor(maxTick / tickSpacing) * tickSpacing;
  return rounded;
}

const PERIOD_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

// ── GET /:address/pools/:poolId/price-history — read-only chart data ─────────
priceHistoryRouter.get(
  "/:address/pools/:poolId/price-history",
  zValidator("param", z.object({ address: z.string(), poolId: z.string() })),
  zValidator("query", z.object({ chainId: z.coerce.number().optional(), period: z.enum(["1h", "24h", "7d"]).default("24h") })),
  async (c) => {
    const { address, poolId } = c.req.valid("param");
    const { chainId, period } = c.req.valid("query");

    const hook = await prisma.hook.findFirst({ where: { address: normalizeAddress(address), ...(chainId ? { chainId } : {}) } });
    if (!hook) return c.json({ error: "Hook not found" }, 404);

    const pool = await prisma.pool.findFirst({ where: { poolId, chainId: hook.chainId } });
    if (!pool) return c.json({ error: "Pool not found" }, 404);

    const since = new Date(Date.now() - PERIOD_MS[period]);
    let rows = await prisma.poolPriceSnapshot.findMany({
      where: { poolId, chainId: hook.chainId, timestamp: { gte: since } },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true, tick: true, price: true },
    });

    // Pools outside the indexer's top-50-by-TVL sweep never get a fresh snapshot
    // pushed to them on their own. Pull-refresh on read instead: if the newest
    // row we have is stale (or there isn't one), take one live on-chain reading
    // right here. The chart polls every 30s, so this keeps an actively-viewed
    // off-sweep pool moving in near-real-time without reading the chain on
    // every single poll — only roughly every other one.
    const latest = rows.at(-1)?.timestamp ?? null;
    // 20s: chart polls every 10s, so a new on-demand snapshot is created roughly
    // every other poll — giving ~20s resolution for real-time LP price tracking.
    // Multiple concurrent users on the same pool share the same snapshot (the
    // staleness guard prevents duplicate reads within the window).
    const isStale = !latest || Date.now() - latest.getTime() > 20_000;
    if (isStale) {
      try {
        let live: { tick: number; price: number } | null = null;
        if (hook.chainId !== SOLANA_CHAIN_ID) {
          live = await tryLiveEvmSnapshot(hook.chainId, hook.address, pool);
        } else if (hook.address === RAYDIUM_AMM_V4_PROGRAM_ID) {
          live = await tryLiveRaydiumSimpleSnapshot("raydium-amm", pool.poolId);
        } else if (hook.address === RAYDIUM_CPMM_PROGRAM_ID) {
          live = await tryLiveRaydiumSimpleSnapshot("raydium-cpmm", pool.poolId);
        }
        if (live) {
          const created = await prisma.poolPriceSnapshot.create({
            data: { poolId, chainId: hook.chainId, tick: live.tick, price: live.price },
          });
          rows = [...rows, { timestamp: created.timestamp, tick: created.tick, price: created.price }];
        }
      } catch {
        /* best-effort — chart just stays as-is until the indexer's next sweep */
      }
    }

    return c.json({ data: rows });
  }
);

// ── GET /:address/pools/:poolId/suggest-range — volatility/trend-based range ─
// Deterministic server-side heuristic, not an LLM call: width comes from
// recent price volatility, center comes from recent trend direction. Falls
// back to a plain ±10% range (matching the existing preset button) when
// there isn't enough accumulated history yet to compute either.
priceHistoryRouter.get(
  "/:address/pools/:poolId/suggest-range",
  zValidator("param", z.object({ address: z.string(), poolId: z.string() })),
  zValidator(
    "query",
    z.object({
      chainId: z.coerce.number().optional(),
      currentTick: z.coerce.number(),
      tickSpacing: z.coerce.number(),
      minTick: z.coerce.number(),
      maxTick: z.coerce.number(),
    })
  ),
  async (c) => {
    const { address, poolId } = c.req.valid("param");
    const { chainId, currentTick, tickSpacing, minTick, maxTick } = c.req.valid("query");

    const hook = await prisma.hook.findFirst({ where: { address: normalizeAddress(address), ...(chainId ? { chainId } : {}) } });
    if (!hook) return c.json({ error: "Hook not found" }, 404);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await prisma.poolPriceSnapshot.findMany({
      where: { poolId, chainId: hook.chainId, timestamp: { gte: since } },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true, price: true },
      take: 500,
    });

    const fallback = () => {
      const delta = Math.round(Math.log(1.1) / Math.log(1.0001));
      return {
        tickLower: nearestUsableTick(currentTick - delta, tickSpacing, minTick, maxTick),
        tickUpper: nearestUsableTick(currentTick + delta, tickSpacing, minTick, maxTick),
        widthPct: 10,
        trendBiasPct: 0,
        sampleSize: rows.length,
        usedFallback: true,
      };
    };

    if (rows.length < 5) return c.json(fallback());

    // ── Volatility via log-returns stddev ─────────────────────────────────────
    // log-returns: r_i = ln(P_i / P_{i-1}) — symmetric, scale-invariant
    const logReturns: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].price;
      const curr = rows[i].price;
      if (prev > 0 && curr > 0) logReturns.push(Math.log(curr / prev));
    }
    if (logReturns.length < 4) return c.json(fallback());

    const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
    // Use Bessel's correction (n-1) for unbiased sample stddev
    const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, logReturns.length - 1);
    const stddev = Math.sqrt(variance);

    // B8-fix: Estimate actual sample interval from timestamps instead of assuming 20s.
    // Real interval varies: indexer sweeps every 2 min, staleness guard is 20s for active
    // pools. Using actual timestamps gives a correct annualisation multiplier.
    const intervalSec = rows.length >= 2
      ? (new Date(rows[rows.length - 1].timestamp).getTime() - new Date(rows[0].timestamp).getTime())
        / Math.max(1, rows.length - 1) / 1000
      : 120; // fallback: 2 min if only one sample
    const samplesPerDay = 86400 / Math.max(intervalSec, 1);
    const dailyVolPct = stddev * Math.sqrt(samplesPerDay) * 100;
    const widthPct = Math.min(50, Math.max(5, dailyVolPct));

    // ── Trend via log-price OLS regression (more stable than price-level OLS) ─
    // B4-fix: Filter out price<=0 rows before OLS (stored as 0 from sqrtPriceX96 underflow).
    // Including them corrupts the slope — price=0 is treated as log(1)=0, creating
    // a phantom downward trend toward 0 from actual pool prices.
    const validRows = rows.filter(r => r.price > 0);
    const n = validRows.length;
    if (n < 4) return c.json(fallback()); // not enough valid data after filtering

    const logPrices = validRows.map((r) => Math.log(r.price));
    const xMean = (n - 1) / 2; // mean of 0..n-1 = (n-1)/2
    const yMean = logPrices.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (logPrices[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    // totalDrift = log-return per sample × n samples = total log-return over window
    const totalDrift = slope * n * 100;
    const trendBiasPct = Math.max(-30, Math.min(30, totalDrift));

    const halfWidthTicks = Math.round(Math.log(1 + widthPct / 100) / Math.log(1.0001));
    const biasTicks = Math.round((trendBiasPct / 100) * halfWidthTicks);

    // B1-fix: Guard against tickLower >= tickUpper after nearestUsableTick clamping.
    // Both endpoints can snap to the same boundary when bias pushes range fully past
    // minTick/maxTick (e.g. near-maxTick pool with +30% upward bias).
    let tickLower = nearestUsableTick(currentTick - halfWidthTicks + biasTicks, tickSpacing, minTick, maxTick);
    let tickUpper = nearestUsableTick(currentTick + halfWidthTicks + biasTicks, tickSpacing, minTick, maxTick);
    if (tickLower >= tickUpper) {
      // Bias pushed both to same boundary — fall back to symmetric unbiased range
      tickLower = nearestUsableTick(currentTick - halfWidthTicks, tickSpacing, minTick, maxTick);
      tickUpper = nearestUsableTick(currentTick + halfWidthTicks, tickSpacing, minTick, maxTick);
    }
    // Final safety: if still equal (e.g. halfWidthTicks = 0), ensure minimum gap
    if (tickLower >= tickUpper) {
      tickLower = nearestUsableTick(currentTick - tickSpacing, tickSpacing, minTick, maxTick);
      tickUpper = nearestUsableTick(currentTick + tickSpacing, tickSpacing, minTick, maxTick);
    }

    return c.json({
      tickLower,
      tickUpper,
      widthPct: Math.round(widthPct * 10) / 10,
      trendBiasPct: Math.round(trendBiasPct * 10) / 10,
      sampleSize: rows.length,
      usedFallback: false,
    });
  }
);
