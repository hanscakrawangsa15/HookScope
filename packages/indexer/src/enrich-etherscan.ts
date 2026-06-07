/**
 * Etherscan enrichment — fetch contract names, source code, and deployer info
 * for all hooks that don't have names yet.
 *
 * Run: pnpm --filter @hookscope/indexer enrich-etherscan
 * Rate: 5 req/sec free tier (250ms delay between requests)
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import { EXPLORER_API_URLS } from "@hookscope/shared";

interface EtherscanSourceResponse {
  status: string;
  result: Array<{
    SourceCode: string;
    ABI: string;
    ContractName: string;
    CompilerVersion: string;
  }>;
}

interface EtherscanCreationResponse {
  status: string;
  result: Array<{
    contractCreator: string;
    txHash: string;
  }>;
}

async function fetchContractInfo(address: string, chainId: number, apiKey?: string) {
  const base = EXPLORER_API_URLS[chainId];
  if (!base) return null;

  const key = apiKey ? `&apikey=${apiKey}` : "";
  const sep = base.includes("?") ? "&" : "?";

  try {
    // Fetch source code + name
    const srcUrl = `${base}${sep}module=contract&action=getsourcecode&address=${address}${key}`;
    const srcRes = await fetch(srcUrl, { signal: AbortSignal.timeout(8000) });
    const srcData = await srcRes.json() as EtherscanSourceResponse;

    let contractName: string | null = null;
    let isVerified = false;
    let sourceFiles: Array<{ name: string; content: string; language: string }> = [];
    let abi: unknown[] = [];

    if (srcData.status === "1" && srcData.result?.[0]?.ContractName) {
      const r = srcData.result[0];
      contractName = r.ContractName || null;
      isVerified = !!r.SourceCode && r.SourceCode !== "";

      if (isVerified) {
        sourceFiles = parseSource(r.SourceCode, r.ContractName);
        try { abi = JSON.parse(r.ABI); } catch { /* non-JSON ABI */ }
      }
    }

    // Fetch deployer info
    const creUrl = `${base}${sep}module=contract&action=getcontractcreation&contractaddresses=${address}${key}`;
    const creRes = await fetch(creUrl, { signal: AbortSignal.timeout(8000) });
    const creData = await creRes.json() as EtherscanCreationResponse;

    let deployer: string | null = null;
    let deployTxHash: string | null = null;
    if (creData.status === "1" && creData.result?.[0]) {
      deployer = creData.result[0].contractCreator?.toLowerCase() ?? null;
      deployTxHash = creData.result[0].txHash ?? null;
    }

    return { contractName, isVerified, sourceFiles, abi, deployer, deployTxHash };
  } catch {
    return null;
  }
}

function parseSource(raw: string, contractName: string): Array<{ name: string; content: string; language: string }> {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    try {
      const inner = trimmed.slice(1, -1);
      const parsed = JSON.parse(inner) as { sources: Record<string, { content: string }> };
      return Object.entries(parsed.sources).map(([name, { content }]) => ({
        name, content, language: "solidity",
      }));
    } catch { /* fall through */ }
  }

  if (trimmed.startsWith("{") && trimmed.includes('"sources"')) {
    try {
      const parsed = JSON.parse(trimmed) as { sources: Record<string, { content: string }> };
      if (parsed.sources) {
        return Object.entries(parsed.sources).map(([name, { content }]) => ({
          name, content, language: "solidity",
        }));
      }
    } catch { /* fall through */ }
  }

  return [{ name: `${contractName}.sol`, content: raw, language: "solidity" }];
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  // Get hooks without names (prioritize chain 1 Ethereum first)
  const hooks = await prisma.hook.findMany({
    where: {
      OR: [{ name: null }, { deployer: null }],
      chainId: { in: [1, 8453, 42161, 10] },
    },
    select: { id: true, address: true, chainId: true, name: true },
    orderBy: [
      { chainId: "asc" },
      { deployedAt: "asc" },
    ],
    take: 500, // process 500 at a time
  });

  const apiKeys: Record<number, string | undefined> = {
    1: process.env.ETHERSCAN_API_KEY,
    8453: process.env.BASESCAN_API_KEY,
    42161: process.env.ARBISCAN_API_KEY,
    10: process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
  };

  console.log(`Enriching ${hooks.length} hooks from Etherscan...\n`);

  let named = 0;
  let verified = 0;
  let failed = 0;

  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i];
    const apiKey = apiKeys[hook.chainId];

    process.stdout.write(`\r  [${i + 1}/${hooks.length}] ${hook.address.slice(0, 14)}...`);

    const info = await fetchContractInfo(hook.address, hook.chainId, apiKey);

    if (info) {
      const updateData: Record<string, unknown> = {
        isVerified: info.isVerified,
        lastAnalyzedAt: new Date(),
      };

      if (info.contractName) { updateData.name = info.contractName; named++; }
      if (info.deployer) updateData.deployer = info.deployer;
      if (info.deployTxHash) updateData.deployTxHash = info.deployTxHash;
      if (info.isVerified) verified++;

      await prisma.hook.update({ where: { id: hook.id }, data: updateData });

      // Save source files
      if (info.sourceFiles.length > 0) {
        await prisma.sourceFile.deleteMany({ where: { hookId: hook.id } });
        await prisma.sourceFile.createMany({
          data: info.sourceFiles.map((sf) => ({
            hookId: hook.id,
            fileName: sf.name,
            content: sf.content,
            language: sf.language,
          })),
        });
      }
    } else {
      failed++;
    }

    // Rate limit: 4 req/sec to stay within free tier
    await sleep(250);
  }

  console.log(`\n\n✅ Enrichment complete!`);
  console.log(`   Named     : ${named}`);
  console.log(`   Verified  : ${verified}`);
  console.log(`   Failed    : ${failed}`);

  await prisma.$disconnect();
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch(console.error);
