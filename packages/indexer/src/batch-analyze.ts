/**
 * Batch analyze ALL hooks using only their address bitmask.
 * No external API needed — flags are deterministically encoded in the address.
 *
 * Sets: riskLevel, hookScore, all callback booleans
 * Time: ~5 seconds for 1000+ hooks
 *
 * Run: pnpm --filter @hookscope/indexer batch-analyze
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import { decodeHookFlags, callbackRiskScore, usesDeltaReturns } from "@hookscope/shared";

const BATCH_SIZE = 100;

function computeScore(flags: ReturnType<typeof decodeHookFlags>, isVerified: boolean, isProxy: boolean): number {
  let score = 100;
  if (!isVerified) score -= 30;
  if (isProxy) score -= 15;
  if (usesDeltaReturns(flags)) score -= 15;

  const cbRisk = callbackRiskScore(flags);
  score -= Math.floor(cbRisk * 0.25);

  const activeCount = Object.values(flags).filter(Boolean).length;
  if (activeCount >= 10) score -= 20; // extreme surface area
  else if (activeCount >= 7) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function scoreToRisk(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 75) return "LOW";
  if (score >= 55) return "MEDIUM";
  if (score >= 35) return "HIGH";
  return "CRITICAL";
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const total = await prisma.hook.count();
  console.log(`Batch analyzing ${total} hooks from address bitmask...\n`);

  let processed = 0;
  let updated = 0;

  // Process in batches to avoid memory issues
  for (let skip = 0; skip < total; skip += BATCH_SIZE) {
    const hooks = await prisma.hook.findMany({
      skip,
      take: BATCH_SIZE,
      select: {
        id: true,
        address: true,
        isVerified: true,
        proxyType: true,
      },
    });

    // Build batch update operations
    const updates = hooks.map((hook) => {
      const addr = hook.address as `0x${string}`;
      const flags = decodeHookFlags(addr);
      const score = computeScore(flags, hook.isVerified, hook.proxyType !== "NONE");
      const riskLevel = scoreToRisk(score);

      return prisma.hook.update({
        where: { id: hook.id },
        data: {
          // Update all callback flags (decoded from address — authoritative)
          beforeInitialize:                   flags.beforeInitialize,
          afterInitialize:                    flags.afterInitialize,
          beforeAddLiquidity:                 flags.beforeAddLiquidity,
          afterAddLiquidity:                  flags.afterAddLiquidity,
          beforeRemoveLiquidity:              flags.beforeRemoveLiquidity,
          afterRemoveLiquidity:               flags.afterRemoveLiquidity,
          beforeSwap:                         flags.beforeSwap,
          afterSwap:                          flags.afterSwap,
          beforeDonate:                       flags.beforeDonate,
          afterDonate:                        flags.afterDonate,
          beforeSwapReturnsDelta:             flags.beforeSwapReturnsDelta,
          afterSwapReturnsDelta:              flags.afterSwapReturnsDelta,
          afterAddLiquidityReturnsDelta:      flags.afterAddLiquidityReturnsDelta,
          afterRemoveLiquidityReturnsDelta:   flags.afterRemoveLiquidityReturnsDelta,
          // Risk assessment
          riskLevel,
          hookScore: score,
          lastAnalyzedAt: new Date(),
        },
      });
    });

    await prisma.$transaction(updates);
    processed += hooks.length;
    updated += hooks.length;

    const pct = Math.round((processed / total) * 100);
    process.stdout.write(`\r  Progress: ${processed}/${total} (${pct}%)`);
  }

  console.log("\n");

  // Print summary
  const byRisk = await prisma.hook.groupBy({
    by: ["riskLevel"],
    _count: { id: true },
  });

  console.log("=== Risk Distribution After Analysis ===");
  const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"];
  for (const level of order) {
    const row = byRisk.find((r) => r.riskLevel === level);
    if (row) {
      const bar = "█".repeat(Math.round((row._count.id / total) * 40));
      console.log(`  ${level.padEnd(10)} ${bar} ${row._count.id} (${Math.round(row._count.id / total * 100)}%)`);
    }
  }

  // Special flags worth reporting
  const withDelta = await prisma.hook.count({
    where: {
      OR: [
        { beforeSwapReturnsDelta: true },
        { afterSwapReturnsDelta: true },
        { afterAddLiquidityReturnsDelta: true },
        { afterRemoveLiquidityReturnsDelta: true },
      ],
    },
  });
  const critical = await prisma.hook.count({ where: { riskLevel: "CRITICAL" } });

  console.log(`\n  Hooks with Delta Returns (custom accounting): ${withDelta}`);
  console.log(`  Critical risk hooks: ${critical}`);
  console.log(`\n✅ Done! Analyzed ${updated} hooks`);

  await prisma.$disconnect();
}

main().catch(console.error);
