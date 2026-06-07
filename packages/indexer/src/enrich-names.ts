/**
 * Enriches hook records with contract names from Etherscan.
 * Hooks yang verified source-nya ada di Etherscan akan mendapat nama otomatis.
 *
 * Run: pnpm --filter @hookscope/indexer enrich
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import { fetchVerifiedSource, fetchDeployerInfo } from "@hookscope/analyzer";
import { EXPLORER_API_URLS } from "@hookscope/shared";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const hooks = await prisma.hook.findMany({
    where: { name: null },
    select: { id: true, address: true, chainId: true },
    orderBy: { deployedAt: "asc" },
  });

  console.log(`Enriching ${hooks.length} unnamed hooks with Etherscan data...\n`);

  const apiKeys: Record<number, string | undefined> = {
    1: process.env.ETHERSCAN_API_KEY,
    8453: process.env.BASESCAN_API_KEY,
    42161: process.env.ARBISCAN_API_KEY,
    10: process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
  };

  let enriched = 0;
  let withSource = 0;

  for (const hook of hooks) {
    const apiKey = apiKeys[hook.chainId];

    // Fetch contract name + source from Etherscan
    const source = await fetchVerifiedSource(hook.address, hook.chainId, apiKey);
    const deployer = await fetchDeployerInfo(hook.address, hook.chainId, apiKey);

    if (source || deployer) {
      await prisma.hook.update({
        where: { id: hook.id },
        data: {
          name: source?.contractName ?? null,
          isVerified: !!source,
          deployer: deployer?.deployer?.toLowerCase() ?? undefined,
          deployTxHash: deployer?.txHash ?? undefined,
        },
      });

      if (source?.sourceFiles.length) {
        await prisma.sourceFile.deleteMany({ where: { hookId: hook.id } });
        await prisma.sourceFile.createMany({
          data: source.sourceFiles.map((sf) => ({
            hookId: hook.id,
            fileName: sf.name,
            content: sf.content,
            language: sf.language,
          })),
        });
        withSource++;
      }

      enriched++;
      console.log(`✓ ${hook.address} → ${source?.contractName ?? 'no name'} ${source ? '(verified)' : ''}`);
    } else {
      process.stdout.write(".");
    }

    // Rate limit: Etherscan allows 5 req/sec on free tier
    await sleep(250);
  }

  console.log(`\n\n✅ Enriched ${enriched}/${hooks.length} hooks`);
  console.log(`   With source code: ${withSource}`);

  await prisma.$disconnect();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch(console.error);
