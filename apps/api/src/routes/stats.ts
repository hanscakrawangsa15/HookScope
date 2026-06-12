import { Hono } from "hono";
import { prisma } from "../db.js";
import { cacheGet, cacheSet } from "../cache.js";

export const statsRouter = new Hono();

// ── GET /stats — Platform-level stats ────────────────────────────────────────
statsRouter.get("/", async (c) => {
  const cacheKey = "stats:global";
  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached);

  const hookAnalyticsSelect = {
    address: true,
    name: true,
    chainId: true,
    riskLevel: true,
    hookScore: true,
    analytics: {
      select: {
        tvlUsd: true,
        poolCount: true,
        swapCount: true,
        volume7dUsd: true,
        volume30dUsd: true,
      },
    },
  } as const;

  const [
    totalHooks,
    verifiedHooks,
    auditedHooks,
    flaggedHooks,
    totalPools,
    hooksByChain,
    hooksByRisk,
    recentHooks,
    topByTvlRaw,
    topByActivityRaw,
  ] = await Promise.all([
    prisma.hook.count(),
    prisma.hook.count({ where: { isVerified: true } }),
    prisma.hook.count({ where: { auditStatus: "AUDITED" } }),
    prisma.hook.count({ where: { auditStatus: "FLAGGED" } }),
    prisma.pool.count(),
    prisma.hook.groupBy({ by: ["chainId"], _count: { id: true } }),
    prisma.hook.groupBy({ by: ["riskLevel"], _count: { id: true } }),
    prisma.hook.findMany({
      orderBy: { deployedAt: "desc" },
      take: 5,
      select: { address: true, name: true, chainId: true, deployedAt: true, hookScore: true },
    }),
    // Top 10 by TVL
    prisma.hook.findMany({
      where: { analytics: { tvlUsd: { gt: 0 } } },
      orderBy: { analytics: { tvlUsd: "desc" } },
      take: 10,
      select: hookAnalyticsSelect,
    }),
    // Top 10 by swap activity (swapCount desc, then pool count)
    prisma.hook.findMany({
      where: { analytics: { swapCount: { gt: 0 } } },
      orderBy: { analytics: { swapCount: "desc" } },
      take: 10,
      select: hookAnalyticsSelect,
    }),
  ]);

  const serializeHook = (h: typeof topByTvlRaw[0]) => ({
    address: h.address,
    name: h.name,
    chainId: h.chainId,
    riskLevel: h.riskLevel,
    hookScore: h.hookScore,
    tvlUsd: h.analytics?.tvlUsd ?? 0,
    poolCount: h.analytics?.poolCount ?? 0,
    swapCount: Number(h.analytics?.swapCount ?? 0),
    volume7dUsd: h.analytics?.volume7dUsd ?? 0,
    volume30dUsd: h.analytics?.volume30dUsd ?? 0,
  });

  const stats = {
    totalHooks,
    verifiedHooks,
    unverifiedHooks: totalHooks - verifiedHooks,
    auditedHooks,
    flaggedHooks,
    totalPools,
    hooksByChain: hooksByChain.reduce((acc, row) => {
      acc[row.chainId] = row._count.id;
      return acc;
    }, {} as Record<number, number>),
    hooksByRisk: hooksByRisk.reduce((acc, row) => {
      acc[row.riskLevel] = row._count.id;
      return acc;
    }, {} as Record<string, number>),
    recentHooks,
    topByTvl: topByTvlRaw.map(serializeHook),
    topByActivity: topByActivityRaw.map(serializeHook),
  };

  await cacheSet(cacheKey, stats, 300); // cache 5 minutes
  return c.json(stats);
});
