/**
 * Solana DEX Program Indexer
 *
 * Treats major Solana AMM programs (Orca Whirlpools, Raydium CLMM, Meteora DLMM)
 * as "hooks" — each program defines swap/liquidity logic the same way Uniswap v4
 * hooks do. Pools are fetched from public REST APIs; no Solana RPC required.
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
    address: "LBUZKhRxPF3XUpBCjp4YzTKgLe4oDxFbcH2bJFGhkr7",
    name: "Meteora DLMM",
    description:
      "Meteora Dynamic Liquidity Market Maker. Uses discrete bin-based liquidity instead of continuous ticks, enabling custom liquidity shapes and dynamic fee adjustment per swap. Audited by OtterSec and Offside Labs.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 82,
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

// DeFiLlama protocol TVL (fallback for Meteora pools)
interface DefillamaTvl {
  date: number;
  totalLiquidityUSD: number;
}
interface DefillamaProtocol {
  tvl: DefillamaTvl[];
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

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("Solana indexer connected to DB");

  try {
    // Register all 5 programs as hooks
    const hookIds: Record<string, string> = {};
    for (const prog of SOLANA_DEX_PROGRAMS) {
      hookIds[prog.address] = await upsertProgram(prisma, prog);
      console.log(`[Solana] Registered: ${prog.name}`);
    }

    // Index pools/TVL for each program
    await indexOrca(prisma, hookIds["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"]);
    await indexRaydium(prisma, hookIds["CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"]);
    await indexMeteora(prisma, hookIds["LBUZKhRxPF3XUpBCjp4YzTKgLe4oDxFbcH2bJFGhkr7"]);

    console.log("\nSolana indexer done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Solana indexer fatal error:", err);
  process.exit(1);
});
