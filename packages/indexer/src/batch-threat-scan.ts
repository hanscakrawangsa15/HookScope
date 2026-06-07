/**
 * Batch Threat Scan — check all indexed hooks against GoPlus Security API.
 *
 * Detects: phishing, address poisoning, sanctions, honeypot, cybercrime,
 * money laundering, darkweb activity, and more.
 *
 * Results are stored as SecurityFlag records (source: "goplus") and the
 * hook's riskLevel is elevated to CRITICAL if severe flags are found.
 *
 * Run: pnpm --filter @hookscope/indexer threat-scan
 * Options:
 *   --chain 1         only scan hooks on this chainId
 *   --limit 100       max hooks to process (default: all)
 *   --rescan          re-check hooks that already have goplus flags
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import { checkAddressThreats } from "./threat-intel.js";

const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 350; // ~3 req/sec — GoPlus free tier is generous

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const chainIdx = args.indexOf("--chain");
  const limitIdx = args.indexOf("--limit");
  return {
    chainId: chainIdx !== -1 ? parseInt(args[chainIdx + 1], 10) : undefined,
    limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined,
    rescan: args.includes("--rescan"),
  };
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const opts = parseArgs();

  // Build query — skip hooks that already have goplus flags unless --rescan
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (opts.chainId) where.chainId = opts.chainId;
  if (!opts.rescan) {
    where.securityFlags = { none: { source: "goplus" } };
  }

  const total = await prisma.hook.count({ where });
  const scanLimit = opts.limit ?? total;

  console.log(`\nHookScope Threat Scanner`);
  console.log(`========================`);
  console.log(`Provider  : GoPlus Security API (free tier)`);
  console.log(`Chains    : ${opts.chainId ?? "all"}`);
  console.log(`To scan   : ${Math.min(total, scanLimit)} hooks`);
  console.log(`Rescan    : ${opts.rescan}`);
  console.log(``);

  let processed = 0;
  let flagged = 0;
  let critical = 0;
  let errors = 0;

  // Summary counters per category
  const categoryCounts: Record<string, number> = {};

  for (let skip = 0; skip < scanLimit; skip += BATCH_SIZE) {
    const hooks = await prisma.hook.findMany({
      where,
      skip,
      take: Math.min(BATCH_SIZE, scanLimit - skip),
      select: { id: true, address: true, chainId: true, riskLevel: true },
      orderBy: { createdAt: "asc" },
    });

    for (const hook of hooks) {
      process.stdout.write(
        `\r  [${processed + 1}/${Math.min(total, scanLimit)}] ${hook.address.slice(0, 16)}... `,
      );

      const threats = await checkAddressThreats(hook.address, hook.chainId);

      if (threats.length > 0) {
        flagged++;
        const hasCritical = threats.some((t) => t.severity === "CRITICAL");
        if (hasCritical) critical++;

        // Delete old goplus flags for this hook (for --rescan mode)
        if (opts.rescan) {
          await prisma.securityFlag.deleteMany({
            where: { hookId: hook.id, source: "goplus" },
          });
        }

        // Insert new flags
        await prisma.securityFlag.createMany({
          data: threats.map((t) => ({
            hookId: hook.id,
            category: t.category,
            severity: t.severity,
            description: t.description,
            source: "goplus",
            reportedBy: t.dataSources.join(", "),
          })),
          skipDuplicates: true,
        });

        // Escalate riskLevel if necessary
        const newRisk = hasCritical ? "CRITICAL" : "HIGH";
        const currentRisk = hook.riskLevel;
        const riskOrder = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
        if (riskOrder.indexOf(newRisk) > riskOrder.indexOf(currentRisk)) {
          await prisma.hook.update({
            where: { id: hook.id },
            data: {
              riskLevel: newRisk,
              auditStatus: "FLAGGED",
            },
          });
        } else {
          // Risk level doesn't need escalating, but still mark auditStatus
          await prisma.hook.update({
            where: { id: hook.id },
            data: { auditStatus: "FLAGGED" },
          });
        }

        // Tally categories
        for (const t of threats) {
          categoryCounts[t.category] = (categoryCounts[t.category] ?? 0) + 1;
        }

        process.stdout.write(`⚠ ${threats.map((t) => t.category).join(", ")}`);
      }

      processed++;
      await sleep(RATE_LIMIT_MS);
    }
  }

  console.log(`\n`);
  console.log(`=== Threat Scan Results ===`);
  console.log(`  Scanned   : ${processed}`);
  console.log(`  Flagged   : ${flagged} (${Math.round((flagged / processed) * 100)}%)`);
  console.log(`  Critical  : ${critical}`);
  console.log(`  Errors    : ${errors}`);

  if (Object.keys(categoryCounts).length > 0) {
    console.log(`\n  Threat breakdown:`);
    for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${cat.padEnd(24)} ${count}`);
    }
  }

  console.log(`\n✅ Threat scan complete!`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
