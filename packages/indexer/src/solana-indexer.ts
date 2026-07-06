/**
 * Solana DEX Program Indexer
 *
 * Treats major Solana AMM/DEX programs as "hooks" — each program defines
 * swap/liquidity logic the same way Uniswap v4 hooks do.
 * Programs (14): Orca Whirlpool, Raydium CLMM, Raydium AMM v4, Raydium CPMM,
 *   Meteora DLMM, Meteora DAMM V1/V2, PumpSwap, Jupiter Perp,
 *   Serum v3, Saber, Drift, Phoenix DEX, Openbook V2
 * Pools/TVL fetched from public REST APIs; no Solana RPC required.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";

const SOLANA_CHAIN_ID = 1399811149;
// Max pools to index per DEX (avoids upserting 177K rows)
const MAX_POOLS_PER_DEX = 500;

// ── Known Solana DEX programs ────────────────────────────────────────────────

interface SolanaDexProgram {
  address: string;
  name: string;
  description: string;
  auditStatus: "AUDITED" | "UNAUDITED";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  hookScore: number;
}

const SOLANA_DEX_PROGRAMS: SolanaDexProgram[] = [
  {
    address: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    name: "Orca Whirlpool",
    description:
      "Orca's concentrated liquidity AMM on Solana. The Whirlpool program manages tick-based liquidity positions, fee collection, and swap execution — analogous to Uniswap v3/v4 core logic. Audited by Kudelski Security.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 88,
  },
  {
    address: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    name: "Raydium CLMM",
    description:
      "Raydium Concentrated Liquidity Market Maker program. Implements tick-range positions, dynamic fee tiers, and reward farming. Handles beforeSwap/afterSwap logic internally via on-chain CPI hooks. Audited by OtterSec.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 84,
  },
  {
    address: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    name: "Raydium AMM v4",
    description:
      "Raydium's original constant-product AMM (AMM v4) — the most widely used liquidity layer on Solana. Routes swaps through Serum/OpenBook order books for capital efficiency. Supports any SPL token pair with permissionless pool creation. One of the first audited AMMs on Solana.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 86,
  },
  {
    address: "LBUZKhRxPF3XUpBCjp4YzTKgLe4oDxFbcH2bJFGhkr7",
    name: "Meteora DLMM",
    description:
      "Meteora Dynamic Liquidity Market Maker. Uses discrete bin-based liquidity instead of continuous ticks, enabling custom liquidity shapes and dynamic fee adjustment per swap. Audited by OtterSec and Offside Labs.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 82,
  },
  {
    address: "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EkAW7vB",
    name: "Meteora DAMM V1",
    description:
      "Meteora Dynamic AMM V1 — a constant-product AMM with yield-bearing vault integration. Idle liquidity is automatically deposited into lending protocols to earn additional yield for LPs while maintaining swap functionality. Audited by OtterSec.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 78,
  },
  {
    address: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    name: "Meteora DAMM V2",
    description:
      "Meteora Dynamic AMM V2 — an improved version of the DAMM protocol with enhanced fee mechanics, multi-hop routing support, and better composability with other Solana DeFi protocols. Supports alpha vaults and customizable fee structures.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 80,
  },
  {
    address: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    name: "PumpSwap",
    description:
      "PumpSwap is pump.fun's native constant-product AMM, launched March 2025. When a bonding curve token graduates from pump.fun, its liquidity migrates automatically to PumpSwap. Enables permissionless trading for all graduated meme tokens with 0.25% swap fees.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 72,
  },
  {
    address: "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
    name: "Phoenix DEX",
    description:
      "Phoenix is a fully on-chain central limit order book (CLOB) on Solana. Market makers can register custom seat authorities that act as hook-like middleware — controlling order placement and fill callbacks.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 79,
  },
  {
    address: "obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y",
    name: "Openbook V2",
    description:
      "Community-governed fork of Project Serum — a fully on-chain CLOB on Solana. Openbook V2 adds event queues and market authority hooks that can intercept fills and cancellations.",
    auditStatus: "UNAUDITED",
    riskLevel: "MEDIUM",
    hookScore: 64,
  },
  {
    address: "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
    name: "Jupiter Perpetual Exchange",
    description:
      "Jupiter Perps is Solana's largest perpetuals DEX, powered by the JLP liquidity pool. Traders can open leveraged long/short positions in SOL, BTC, ETH, and other assets. The JLP pool acts as the counterparty, earning fees from swaps, borrows, and liquidations. Audited by OtterSec and Offside Labs.",
    auditStatus: "AUDITED",
    riskLevel: "MEDIUM",
    hookScore: 81,
  },
  {
    address: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    name: "Raydium CPMM",
    description:
      "Raydium Constant Product Market Maker — Raydium's modern permissionless XYK AMM launched in late 2024. Unlike AMM v4 (which routes through Serum order books), CPMM is a pure constant-product AMM with customizable fee tiers, no order book dependency, and support for token2022 assets. Audited by OtterSec.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 83,
  },
  {
    address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    name: "Serum v3",
    description:
      "Project Serum v3 — the original fully on-chain central limit order book (CLOB) on Solana, built by FTX/Alameda. Despite the FTX collapse, the protocol continues operating autonomously. Serum's order matching engine and settlement hooks inspired subsequent Solana DEX designs including OpenBook and Raydium. Governance is now community-led.",
    auditStatus: "UNAUDITED",
    riskLevel: "HIGH",
    hookScore: 40,
  },
  {
    address: "SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ",
    name: "Saber",
    description:
      "Saber is Solana's leading stable-asset AMM, optimized for trading between assets of similar value: stablecoins (USDC/USDT), wrapped tokens (wBTC/renBTC), and liquid staking tokens (stSOL/mSOL). Uses a StableSwap invariant (similar to Curve Finance) that minimizes slippage for pegged pairs. Audited by Certik.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 70,
  },
  {
    address: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    name: "Drift Protocol",
    description:
      "Drift is a decentralized perpetuals and spot exchange on Solana using a cross-margining engine. It features a dynamic AMM (DAMM) as the backstop liquidity provider, complemented by a Decentralized Limit Order Book (DLOB) for limit orders. Supports up to 20x leverage on major assets. Audited by OtterSec and Halborn.",
    auditStatus: "AUDITED",
    riskLevel: "MEDIUM",
    hookScore: 76,
  },
];

// ── API response types ────────────────────────────────────────────────────────

// Orca Whirlpool API — GET https://api.mainnet.orca.so/v1/whirlpool/list
interface OrcaWhirlpool {
  address: string;
  tokenA: { mint: string; symbol: string };
  tokenB: { mint: string; symbol: string };
  tvl: number;
  volume: { day: number; week: number; month: number };
  lpFeeRate: number;   // e.g. 0.0004 = 0.04%
  tickSpacing: number;
}
interface OrcaResponse {
  whirlpools: OrcaWhirlpool[];
}

// Raydium CLMM API — GET https://api.raydium.io/v2/ammV3/ammPools
// mintA / mintB are plain base58 address strings (not objects)
interface RaydiumPool {
  id: string;
  mintA: string;
  mintB: string;
  tvl: number;
  day: { volume: number };
  week: { volume: number };
  month: { volume: number };
  ammConfig: { tradeFeeRate: number; tickSpacing: number };
}
interface RaydiumResponse {
  data: RaydiumPool[];
}

// DeFiLlama protocol TVL (fallback when pool API is unavailable)
interface DefillamaTvl {
  date: number;
  totalLiquidityUSD: number;
}
interface DefillamaProtocol {
  tvl: DefillamaTvl[];
}

// Raydium v3 unified pools API — GET https://api-v3.raydium.io/pools/info/list
// Covers Concentrated (CLMM) + Standard (AMM v4 + CPMM) pools, distinguishable
// only by programId. poolType=Standard alone is rejected by the API — must
// request poolType=all and filter client-side.
interface RaydiumV3Pool {
  id: string;
  programId: string;
  mintA: { address: string; symbol: string };
  mintB: { address: string; symbol: string };
  feeRate: number; // decimal fraction, e.g. 0.0025 = 0.25%
  tvl: number;
  day: { volume: number };
  week: { volume: number };
  month: { volume: number };
}
interface RaydiumV3Response {
  success: boolean;
  data: { count: number; data: RaydiumV3Pool[] };
}


// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, label: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HookScope-Indexer/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[Solana] ${label}: HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[Solana] ${label} fetch failed:`, (err as Error).message);
    return null;
  }
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsertProgram(
  prisma: PrismaClient,
  prog: SolanaDexProgram
): Promise<string> {
  const hook = await prisma.hook.upsert({
    where: { address_chainId: { address: prog.address, chainId: SOLANA_CHAIN_ID } },
    create: {
      address: prog.address,
      chainId: SOLANA_CHAIN_ID,
      name: prog.name,
      description: prog.description,
      isVerified: prog.auditStatus === "AUDITED",
      auditStatus: prog.auditStatus,
      riskLevel: prog.riskLevel,
      hookScore: prog.hookScore,
      proxyType: "NONE",
      // All Solana AMM programs handle the full swap + liquidity lifecycle
      beforeSwap: true,
      afterSwap: true,
      beforeAddLiquidity: true,
      afterAddLiquidity: true,
      beforeRemoveLiquidity: true,
      afterRemoveLiquidity: true,
      lastIndexedAt: new Date(),
    },
    update: {
      name: prog.name,
      description: prog.description,
      hookScore: prog.hookScore,
      riskLevel: prog.riskLevel,
      auditStatus: prog.auditStatus,
      isVerified: prog.auditStatus === "AUDITED",
      lastIndexedAt: new Date(),
    },
  });
  return hook.id;
}

async function upsertPool(
  prisma: PrismaClient,
  hookId: string,
  poolId: string,
  token0: string,
  token1: string,
  token0Symbol: string,
  token1Symbol: string,
  fee: number,
  tickSpacing: number,
  tvlUsd: number
) {
  await prisma.pool.upsert({
    where: { poolId_chainId: { poolId, chainId: SOLANA_CHAIN_ID } },
    create: {
      poolId,
      hookId,
      chainId: SOLANA_CHAIN_ID,
      token0,
      token1,
      token0Symbol,
      token1Symbol,
      fee: Math.max(0, Math.min(fee, 2_000_000)), // clamp to valid Int range
      tickSpacing: Math.max(1, tickSpacing),
      tvlUsd,
      isActive: true,
    },
    update: {
      tvlUsd,
      token0Symbol,
      token1Symbol,
    },
  });
}

// ── Orca indexer ──────────────────────────────────────────────────────────────

async function indexOrca(prisma: PrismaClient, hookId: string) {
  console.log("[Orca] Fetching whirlpools...");
  const data = await fetchJson<OrcaResponse>(
    "https://api.mainnet.orca.so/v1/whirlpool/list",
    "Orca"
  );
  const all = data?.whirlpools ?? [];
  console.log(`[Orca] Got ${all.length} pools`);

  // Take top pools by TVL to keep indexing fast
  const top = [...all]
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
    .slice(0, MAX_POOLS_PER_DEX);

  let upserted = 0;
  for (const p of top) {
    try {
      // lpFeeRate is a decimal like 0.0004 → convert to micro-bps (×1_000_000)
      const fee = Math.round((p.lpFeeRate ?? 0) * 1_000_000);
      await upsertPool(
        prisma, hookId,
        p.address,
        p.tokenA?.mint ?? "",
        p.tokenB?.mint ?? "",
        p.tokenA?.symbol ?? "?",
        p.tokenB?.symbol ?? "?",
        fee,
        p.tickSpacing ?? 1,
        p.tvl ?? 0,
      );
      upserted++;
    } catch (err) {
      console.warn(`[Orca] Pool ${p.address?.slice(0, 8)} failed:`, (err as Error).message);
    }
  }

  const totalTvl = all.reduce((s, p) => s + (p.tvl ?? 0), 0);
  const vol7d = all.reduce((s, p) => s + (p.volume?.week ?? 0), 0);
  const vol30d = all.reduce((s, p) => s + (p.volume?.month ?? 0), 0);

  await prisma.hookAnalytics.upsert({
    where: { hookId },
    create: { hookId, tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: all.length },
    update: { tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: all.length, updatedAt: new Date() },
  });

  console.log(`[Orca] Upserted ${upserted}/${top.length} top pools, total TVL $${(totalTvl / 1e6).toFixed(1)}M`);
}

// ── Raydium indexer ───────────────────────────────────────────────────────────

async function indexRaydium(prisma: PrismaClient, hookId: string) {
  console.log("[Raydium] Fetching CLMM pools...");
  const data = await fetchJson<RaydiumResponse>(
    "https://api.raydium.io/v2/ammV3/ammPools",
    "Raydium CLMM"
  );
  const all = data?.data ?? [];
  console.log(`[Raydium] Got ${all.length} pools`);

  // Sort by TVL, take top N
  const top = [...all]
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
    .slice(0, MAX_POOLS_PER_DEX);

  let upserted = 0;
  for (const p of top) {
    try {
      // mintA / mintB are plain base58 strings — no .address or .symbol fields
      const token0 = typeof p.mintA === "string" ? p.mintA : "";
      const token1 = typeof p.mintB === "string" ? p.mintB : "";
      if (!token0 || !token1) continue;

      // tradeFeeRate is already in millionths (e.g. 100 = 0.01%)
      const fee = p.ammConfig?.tradeFeeRate ?? 0;

      await upsertPool(
        prisma, hookId,
        p.id,
        token0,
        token1,
        token0.slice(0, 6), // no symbol in API; use truncated address
        token1.slice(0, 6),
        fee,
        p.ammConfig?.tickSpacing ?? 1,
        p.tvl ?? 0,
      );
      upserted++;
    } catch (err) {
      console.warn(`[Raydium] Pool ${p.id?.slice(0, 8)} failed:`, (err as Error).message);
    }
  }

  const totalTvl = all.reduce((s, p) => s + (p.tvl ?? 0), 0);
  const vol7d = all.reduce((s, p) => s + (p.week?.volume ?? 0), 0);
  const vol30d = all.reduce((s, p) => s + (p.month?.volume ?? 0), 0);

  await prisma.hookAnalytics.upsert({
    where: { hookId },
    create: { hookId, tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: all.length },
    update: { tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: all.length, updatedAt: new Date() },
  });

  console.log(`[Raydium] Upserted ${upserted}/${top.length} top pools, total TVL $${(totalTvl / 1e6).toFixed(1)}M`);
}

// ── Meteora indexer (TVL only — pool API unavailable) ─────────────────────────

async function indexMeteora(prisma: PrismaClient, hookId: string) {
  console.log("[Meteora] Fetching TVL from DeFiLlama...");
  const data = await fetchJson<DefillamaProtocol>(
    "https://api.llama.fi/protocol/meteora-dlmm",
    "Meteora via DeFiLlama"
  );

  const latestTvl = data?.tvl?.at(-1)?.totalLiquidityUSD ?? 0;

  await prisma.hookAnalytics.upsert({
    where: { hookId },
    create: { hookId, tvlUsd: latestTvl, volume7dUsd: 0, volume30dUsd: 0, poolCount: 0 },
    update: { tvlUsd: latestTvl, updatedAt: new Date() },
  });

  console.log(`[Meteora] TVL $${(latestTvl / 1e6).toFixed(1)}M (pool API unavailable, TVL from DeFiLlama)`);
}

// ── Raydium AMM v4 + CPMM indexer (v3 unified pools API, paginated) ───────────

const RAYDIUM_AMM_V4_PROGRAM_ID = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const RAYDIUM_CPMM_PROGRAM_ID = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";

async function indexRaydiumStandardPools(
  prisma: PrismaClient,
  ammV4HookId: string,
  cpmmHookId: string,
) {
  console.log("[Raydium] Fetching AMM v4 + CPMM pools from v3 API...");

  const ammV4Pools: RaydiumV3Pool[] = [];
  const cpmmPools: RaydiumV3Pool[] = [];
  const MAX_PAGES = 30;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetchJson<RaydiumV3Response>(
      `https://api-v3.raydium.io/pools/info/list?poolType=all&poolSortField=liquidity&sortType=desc&pageSize=100&page=${page}`,
      `Raydium v3 pools page ${page}`,
    );
    const rows = data?.data?.data ?? [];
    if (rows.length === 0) break;

    for (const p of rows) {
      if (p.programId === RAYDIUM_AMM_V4_PROGRAM_ID) ammV4Pools.push(p);
      else if (p.programId === RAYDIUM_CPMM_PROGRAM_ID) cpmmPools.push(p);
    }

    if (ammV4Pools.length >= MAX_POOLS_PER_DEX && cpmmPools.length >= MAX_POOLS_PER_DEX) break;
    if (rows.length < 100) break; // last page
  }

  console.log(`[Raydium] Got ${ammV4Pools.length} AMM v4 pools, ${cpmmPools.length} CPMM pools`);

  await indexRaydiumStandardSet(prisma, ammV4HookId, ammV4Pools.slice(0, MAX_POOLS_PER_DEX), "Raydium AMM v4");
  await indexRaydiumStandardSet(prisma, cpmmHookId, cpmmPools.slice(0, MAX_POOLS_PER_DEX), "Raydium CPMM");
}

async function indexRaydiumStandardSet(
  prisma: PrismaClient,
  hookId: string,
  pools: RaydiumV3Pool[],
  label: string,
) {
  let upserted = 0;
  for (const p of pools) {
    try {
      const fee = Math.round((p.feeRate ?? 0) * 1_000_000);
      await upsertPool(
        prisma, hookId,
        p.id,
        p.mintA?.address ?? "",
        p.mintB?.address ?? "",
        p.mintA?.symbol ?? "?",
        p.mintB?.symbol ?? "?",
        fee,
        1, // no tick concept for constant-product pools
        p.tvl ?? 0,
      );
      upserted++;
    } catch (err) {
      console.warn(`[${label}] Pool ${p.id?.slice(0, 8)} failed:`, (err as Error).message);
    }
  }

  const totalTvl = pools.reduce((s, p) => s + (p.tvl ?? 0), 0);
  const vol7d = pools.reduce((s, p) => s + (p.week?.volume ?? 0), 0);
  const vol30d = pools.reduce((s, p) => s + (p.month?.volume ?? 0), 0);

  await prisma.hookAnalytics.upsert({
    where: { hookId },
    create: { hookId, tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: pools.length },
    update: { tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: pools.length, updatedAt: new Date() },
  });

  console.log(`[${label}] Upserted ${upserted}/${pools.length} pools, total TVL $${(totalTvl / 1e6).toFixed(1)}M`);
}

// ── Generic DeFiLlama TVL indexer (for programs without public pool API) ──────

async function indexDeFiLlamaTvl(
  prisma: PrismaClient,
  hookId: string,
  slug: string,
  label: string,
) {
  console.log(`[${label}] Fetching TVL from DeFiLlama (slug: ${slug})...`);
  const data = await fetchJson<DefillamaProtocol>(
    `https://api.llama.fi/protocol/${slug}`,
    label
  );

  const latestTvl = data?.tvl?.at(-1)?.totalLiquidityUSD ?? 0;

  await prisma.hookAnalytics.upsert({
    where: { hookId },
    create: { hookId, tvlUsd: latestTvl, volume7dUsd: 0, volume30dUsd: 0, poolCount: 0 },
    update: { tvlUsd: latestTvl, updatedAt: new Date() },
  });

  console.log(`[${label}] TVL $${(latestTvl / 1e6).toFixed(1)}M (pool API unavailable, TVL from DeFiLlama)`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("Solana indexer connected to DB");

  try {
    // Register all 14 programs as hooks
    const hookIds: Record<string, string> = {};
    for (const prog of SOLANA_DEX_PROGRAMS) {
      hookIds[prog.address] = await upsertProgram(prisma, prog);
      console.log(`[Solana] Registered: ${prog.name}`);
    }

    // Index pools/TVL for each program
    await indexOrca(prisma, hookIds["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"]);
    await indexRaydium(prisma, hookIds["CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"]);
    await indexRaydiumStandardPools(
      prisma,
      hookIds["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"],
      hookIds["CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"],
    );
    await indexMeteora(prisma, hookIds["LBUZKhRxPF3XUpBCjp4YzTKgLe4oDxFbcH2bJFGhkr7"]);
    await indexDeFiLlamaTvl(prisma, hookIds["Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EkAW7vB"], "meteora-damm-v1", "Meteora DAMM V1");
    await indexDeFiLlamaTvl(prisma, hookIds["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"], "meteora-damm-v2", "Meteora DAMM V2");
    await indexDeFiLlamaTvl(prisma, hookIds["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"], "pumpswap", "PumpSwap");
    await indexDeFiLlamaTvl(prisma, hookIds["PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu"], "jupiter-perpetual-exchange", "Jupiter Perp");
    await indexDeFiLlamaTvl(prisma, hookIds["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"], "serum", "Serum v3");
    await indexDeFiLlamaTvl(prisma, hookIds["SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ"], "saber", "Saber");
    await indexDeFiLlamaTvl(prisma, hookIds["dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH"], "drift-trade", "Drift");

    console.log("\nSolana indexer done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Solana indexer fatal error:", err);
  process.exit(1);
});
