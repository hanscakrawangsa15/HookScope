/**
 * Standalone analytics runner — jalankan sekali untuk fetch TVL real-time.
 * Run: pnpm --filter @hookscope/indexer analytics
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import { AnalyticsService } from "./analytics-service.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const svc = new AnalyticsService(prisma);
  await svc.refresh();

  // Print result
  const [hooks, pools, tvl] = await Promise.all([
    prisma.hook.count(),
    prisma.pool.count(),
    prisma.hookAnalytics.aggregate({ _sum: { tvlUsd: true } }),
  ]);
  const top = await prisma.hookAnalytics.findMany({
    where: { tvlUsd: { gt: 0 } },
    orderBy: { tvlUsd: "desc" },
    take: 5,
    include: { hook: { select: { address: true, name: true } } },
  });

  console.log(`\n✅ Analytics complete`);
  console.log(`   Hooks: ${hooks} | Pools: ${pools} | Total TVL: $${(tvl._sum.tvlUsd ?? 0).toLocaleString()}`);
  if (top.length > 0) {
    console.log("\n   Top hooks by TVL:");
    top.forEach((a) => {
      console.log(`   - ${a.hook.name ?? a.hook.address.slice(0, 14)}... : $${a.tvlUsd.toLocaleString()}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(console.error);
