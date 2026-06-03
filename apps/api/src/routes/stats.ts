import { Hono } from "hono";
import { prisma } from "../db.js";
import { cacheGet, cacheSet } from "../cache.js";

export const statsRouter = new Hono();

// ── GET /stats — Platform-level stats ────────────────────────────────────────
statsRouter.get("/", async (c) => {
  const cacheKey = "stats:global";
  const cached = await cacheGet(cacheKey);
  if (cached) return c.json(cached);

  const [
    totalHooks,
    verifiedHooks,
    auditedHooks,
    flaggedHooks,
    totalPools,
    hooksByChain,
    hooksByRisk,
    recentHooks,
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
  ]);

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
  };

  await cacheSet(cacheKey, stats, 300); // cache 5 minutes
  return c.json(stats);
});
