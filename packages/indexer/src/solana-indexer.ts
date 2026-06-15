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

// ── Known Solana DEX programs ────────────────────────────────────────────────

interface SolanaDexProgram {
  address: string;
  name: string;
  description: string;
  auditStatus: "AUDITED" | "UNAUDITED";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  hookScore: number;
  explorerUrl: string;
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
    explorerUrl:
      "https://solscan.io/account/whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  },
  {
    address: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    name: "Raydium CLMM",
    description:
      "Raydium Concentrated Liquidity Market Maker program. Implements tick-range positions, dynamic fee tiers, and reward farming. Handles beforeSwap/afterSwap logic internally via on-chain CPI hooks. Audited by OtterSec.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 84,
    explorerUrl:
      "https://solscan.io/account/CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  },
  {
    address: "LBUZKhRxPF3XUpBCjp4YzTKgLe4oDxFbcH2bJFGhkr7",
    name: "Meteora DLMM",
    description:
      "Meteora Dynamic Liquidity Market Maker. Uses discrete bin-based liquidity instead of continuous ticks, enabling custom liquidity shapes and dynamic fee adjustment per swap. Audited by OtterSec and Offside Labs.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 82,
    explorerUrl:
      "https://solscan.io/account/LBUZKhRxPF3XUpBCjp4YzTKgLe4oDxFbcH2bJFGhkr7",
  },
  {
    address: "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
    name: "Phoenix DEX",
    description:
      "Phoenix is a fully on-chain central limit order book (CLOB) on Solana. Market makers can register custom seat authorities that act as hook-like middleware — controlling order placement and fill callbacks.",
    auditStatus: "AUDITED",
    riskLevel: "LOW",
    hookScore: 79,
    explorerUrl:
      "https://solscan.io/account/PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
  },
  {
    address: "obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y",
    name: "Openbook V2",
    description:
      "Community-governed fork of Project Serum — a fully on-chain CLOB on Solana. Openbook V2 adds event queues and market authority hooks that can intercept fills and cancellations.",
    auditStatus: "UNAUDITED",
    riskLevel: "MEDIUM",
    hookScore: 64,
    explorerUrl:
      "https://solscan.io/account/obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y",
  },
];

// ── API response types ────────────────────────────────────────────────────────

interface OrcaWhirlpool {
  address: string;
  tokenA: { mint: string; symbol: string; decimals: number };
  tokenB: { mint: string; symbol: string; decimals: number };
  tvl: number;
  volume: { day: number; week: number; month: number };
  feeRate: number;
  tickSpacing: number;
}
interface OrcaResponse {
  whirlpools: OrcaWhirlpool[];
}

interface RaydiumPool {
  id: string;
  mintA: { address: string; symbol: string; decimals: number };
  mintB: { address: string; symbol: string; decimals: number };
  tvl: number;
  day: { volume: number };
  week: { volume: number };
  month: { volume: number };
  ammConfig: { tradeFeeRate: number; tickSpacing: number };
}
interface RaydiumResponse {
  data: RaydiumPool[];
}

interface MeteoraPair {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  liquidity: string;
  fees_24h: number;
  trade_volume_24h: number;
  trade_volume_7d?: number;
  trade_volume_month?: number;
  bin_step: number;
  base_fee_percentage: string;
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

async function fetchOrcaPools(): Promise<OrcaWhirlpool[]> {
  const data = await fetchJson<OrcaResponse>(
    "https://api.mainnet.orca.so/v1/whirlpool/list",
    "Orca"
  );
  return data?.whirlpools ?? [];
}

async function fetchRaydiumPools(): Promise<RaydiumPool[]> {
  const data = await fetchJson<RaydiumResponse>(
    "https://api.raydium.io/v2/ammV3/ammPools",
    "Raydium CLMM"
  );
  return data?.data ?? [];
}

async function fetchMeteoraPairs(): Promise<MeteoraPair[]> {
  const data = await fetchJson<MeteoraPair[]>(
    "https://dlmm-api.meteora.ag/pair/all",
    "Meteora DLMM"
  );
  return Array.isArray(data) ? data : [];
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
  tvlUsd: number | null
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
      fee,
      tickSpacing,
      tvlUsd: tvlUsd ?? 0,
      isActive: true,
    },
    update: {
      tvlUsd: tvlUsd ?? 0,
      token0Symbol,
      token1Symbol,
    },
  });
}

// ── Main indexer ──────────────────────────────────────────────────────────────

async function indexOrca(prisma: PrismaClient, hookId: string) {
  console.log("[Orca] Fetching whirlpools...");
  const pools = await fetchOrcaPools();
  console.log(`[Orca] Got ${pools.length} pools`);

  let upserted = 0;
  for (const p of pools) {
    try {
      await upsertPool(
        prisma,
        hookId,
        p.address,
        p.tokenA.mint,
        p.tokenB.mint,
        p.tokenA.symbol ?? "?",
        p.tokenB.symbol ?? "?",
        Math.round(p.feeRate * 1_000_000), // basis points → micro-bps
        p.tickSpacing,
        typeof p.tvl === "number" ? p.tvl : null
      );
      upserted++;
    } catch {
      // skip individual pool errors
    }
  }

  const totalTvl = pools.reduce((s, p) => s + (typeof p.tvl === "number" ? p.tvl : 0), 0);
  const vol7d = pools.reduce((s, p) => s + (p.volume?.week ?? 0), 0);
  const vol30d = pools.reduce((s, p) => s + (p.volume?.month ?? 0), 0);

  await prisma.hookAnalytics.upsert({
    where: { hookId },
    create: { hookId, tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: upserted },
    update: { tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: upserted, updatedAt: new Date() },
  });

  console.log(`[Orca] Upserted ${upserted} pools, TVL $${(totalTvl / 1e6).toFixed(1)}M`);
}

async function indexRaydium(prisma: PrismaClient, hookId: string) {
  console.log("[Raydium] Fetching CLMM pools...");
  const pools = await fetchRaydiumPools();
  console.log(`[Raydium] Got ${pools.length} pools`);

  let upserted = 0;
  for (const p of pools) {
    try {
      await upsertPool(
        prisma,
        hookId,
        p.id,
        p.mintA.address,
        p.mintB.address,
        p.mintA.symbol ?? "?",
        p.mintB.symbol ?? "?",
        Math.round((p.ammConfig?.tradeFeeRate ?? 0) * 1_000_000),
        p.ammConfig?.tickSpacing ?? 1,
        typeof p.tvl === "number" ? p.tvl : null
      );
      upserted++;
    } catch {
      // skip individual pool errors
    }
  }

  const totalTvl = pools.reduce((s, p) => s + (typeof p.tvl === "number" ? p.tvl : 0), 0);
  const vol7d = pools.reduce((s, p) => s + (p.week?.volume ?? 0), 0);
  const vol30d = pools.reduce((s, p) => s + (p.month?.volume ?? 0), 0);

  await prisma.hookAnalytics.upsert({
    where: { hookId },
    create: { hookId, tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: upserted },
    update: { tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: upserted, updatedAt: new Date() },
  });

  console.log(`[Raydium] Upserted ${upserted} pools, TVL $${(totalTvl / 1e6).toFixed(1)}M`);
}

async function indexMeteora(prisma: PrismaClient, hookId: string) {
  console.log("[Meteora] Fetching DLMM pairs...");
  const pairs = await fetchMeteoraPairs();
  console.log(`[Meteora] Got ${pairs.length} pairs`);

  let upserted = 0;
  for (const p of pairs) {
    try {
      const tvl = parseFloat(p.liquidity) || null;
      const [symX, symY] = (p.name ?? "?/?").split("-");
      await upsertPool(
        prisma,
        hookId,
        p.address,
        p.mint_x,
        p.mint_y,
        symX?.trim() ?? "?",
        symY?.trim() ?? "?",
        Math.round(parseFloat(p.base_fee_percentage ?? "0") * 10_000),
        p.bin_step,
        tvl
      );
      upserted++;
    } catch {
      // skip individual pair errors
    }
  }

  const totalTvl = pairs.reduce((s, p) => s + (parseFloat(p.liquidity) || 0), 0);
  const vol7d = pairs.reduce((s, p) => s + (p.trade_volume_7d ?? p.trade_volume_24h * 7), 0);
  const vol30d = pairs.reduce((s, p) => s + (p.trade_volume_month ?? p.trade_volume_24h * 30), 0);

  await prisma.hookAnalytics.upsert({
    where: { hookId },
    create: { hookId, tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: upserted },
    update: { tvlUsd: totalTvl, volume7dUsd: vol7d, volume30dUsd: vol30d, poolCount: upserted, updatedAt: new Date() },
  });

  console.log(`[Meteora] Upserted ${upserted} pairs, TVL $${(totalTvl / 1e6).toFixed(1)}M`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("Solana indexer connected to DB");

  try {
    // Upsert all 5 programs first
    const hookIds: Record<string, string> = {};
    for (const prog of SOLANA_DEX_PROGRAMS) {
      hookIds[prog.address] = await upsertProgram(prisma, prog);
      console.log(`[Solana] Registered program: ${prog.name} (${prog.address.slice(0, 8)}...)`);
    }

    // Index pools for the three API-supported programs
    await indexOrca(prisma, hookIds["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"]);
    await indexRaydium(prisma, hookIds["CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"]);
    await indexMeteora(prisma, hookIds["LBUZKhRxPF3XUpBCjp4YzTKgLe4oDxFbcH2bJFGhkr7"]);

    console.log("Solana indexer done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Solana indexer fatal error:", err);
  process.exit(1);
});
