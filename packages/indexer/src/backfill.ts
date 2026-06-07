/**
 * HookScope Backfill Script
 *
 * Scans ALL blocks from Uniswap v4 PoolManager deployment to present,
 * finding every single hook that has ever been used — including ones
 * that v4.xyz and other curated platforms have never seen.
 *
 * Run: pnpm --filter @hookscope/indexer backfill
 *
 * Strategy:
 * 1. Query PoolManager.Initialize events in chunks of 2000 blocks
 * 2. For each event, extract hook address + decode flags from address bitmask
 * 3. For each unique hook: fetch source (Etherscan), bytecode, proxy info
 * 4. Persist everything to PostgreSQL
 * 5. Enrich with TVL from TheGraph (if API key available)
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { createPublicClient, http, type Log } from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import { PrismaClient } from "@prisma/client";
import {
  POOL_MANAGER_ADDRESSES,
  decodeHookFlags,
  isNoOpHook,
} from "@hookscope/shared";
import { fetchVerifiedSource, fetchDeployerInfo, detectProxy, analyzeBytecode, computeHookScore, HookAnalyzer } from "@hookscope/analyzer";
import { TheGraphClient } from "./thegraph-client.js";

const INITIALIZE_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

// v4 PoolManager deploy blocks
const DEPLOY_BLOCKS: Record<number, bigint> = {
  1:     21688400n,   // Ethereum mainnet Jan 2025
  8453:  22817400n,   // Base
  42161: 281600000n,  // Arbitrum
  10:    129200000n,  // Optimism
};

const CHUNK_SIZE = 2000n;

interface ChainSetup {
  chainId: number;
  name: string;
  rpcUrl: string | undefined;
  explorerApiKey: string | undefined;
}

const CHAINS: ChainSetup[] = [
  { chainId: 1,     name: "Ethereum", rpcUrl: process.env.ETHEREUM_RPC_URL, explorerApiKey: process.env.ETHERSCAN_API_KEY },
  { chainId: 8453,  name: "Base",     rpcUrl: process.env.BASE_RPC_URL,     explorerApiKey: process.env.BASESCAN_API_KEY },
  { chainId: 42161, name: "Arbitrum", rpcUrl: process.env.ARBITRUM_RPC_URL, explorerApiKey: process.env.ARBISCAN_API_KEY },
  { chainId: 10,    name: "Optimism", rpcUrl: process.env.OPTIMISM_RPC_URL, explorerApiKey: process.env.OPTIMISTIC_ETHERSCAN_API_KEY },
];

const VIEM_CHAINS: Record<number, typeof mainnet> = {
  1: mainnet, 8453: base, 42161: arbitrum, 10: optimism,
};

async function backfillChain(setup: ChainSetup, prisma: PrismaClient): Promise<void> {
  if (!setup.rpcUrl) {
    console.log(`[${setup.name}] Skipping — no RPC URL configured`);
    return;
  }

  const poolManager = POOL_MANAGER_ADDRESSES[setup.chainId];
  if (!poolManager) return;

  const chain = VIEM_CHAINS[setup.chainId];
  const client = createPublicClient({
    chain,
    transport: http(setup.rpcUrl, { retryCount: 3, retryDelay: 2000 }),
  });

  const latestBlock = await client.getBlockNumber();
  const fromBlock = DEPLOY_BLOCKS[setup.chainId] ?? 0n;

  console.log(`\n[${setup.name}] Scanning blocks ${fromBlock.toLocaleString()} → ${latestBlock.toLocaleString()}`);
  console.log(`[${setup.name}] Total range: ${(latestBlock - fromBlock).toLocaleString()} blocks`);

  let totalEvents = 0;
  let totalHooks = 0;
  let processed = fromBlock;

  while (processed <= latestBlock) {
    const toBlock = processed + CHUNK_SIZE - 1n < latestBlock
      ? processed + CHUNK_SIZE - 1n
      : latestBlock;

    let logs: Log[] = [];
    try {
      logs = await client.getLogs({
        address: poolManager,
        topics: [INITIALIZE_TOPIC as `0x${string}`],
        fromBlock: processed,
        toBlock,
      });
    } catch (err) {
      console.error(`[${setup.name}] Log fetch error at ${processed}:`, err);
      processed = toBlock + 1n;
      continue;
    }

    for (const log of logs) {
      totalEvents++;
      const newHook = await processLog(log, setup, client, prisma);
      if (newHook) totalHooks++;
    }

    // Progress update every 50k blocks
    if ((processed - fromBlock) % 50000n === 0n) {
      const pct = Number(((processed - fromBlock) * 100n) / (latestBlock - fromBlock));
      console.log(`[${setup.name}] ${pct}% — block ${processed.toLocaleString()} | events: ${totalEvents} | new hooks: ${totalHooks}`);
    }

    processed = toBlock + 1n;
  }

  console.log(`\n[${setup.name}] ✅ Complete! ${totalEvents} events, ${totalHooks} new hooks`);
}

async function processLog(
  log: Log,
  setup: ChainSetup,
  client: ReturnType<typeof createPublicClient>,
  prisma: PrismaClient
): Promise<boolean> {
  // Parse Initialize event data
  // Indexed: id (bytes32), currency0 (address), currency1 (address)
  // Data: fee(uint24) + tickSpacing(int24) + hooks(address) + sqrtPriceX96(uint160) + tick(int24)
  const data = log.data.slice(2); // remove 0x
  if (data.length < 5 * 64) return false;

  const hooksRaw = data.slice(2 * 64, 3 * 64);
  const hookAddress = ("0x" + hooksRaw.slice(-40)) as `0x${string}`;

  if (isNoOpHook(hookAddress)) return false;

  const fee = parseInt(data.slice(0, 64), 16);
  const tickSpacing = parseInt(data.slice(64, 128), 16);
  const poolId = log.topics[1] as string;
  const token0 = ("0x" + (log.topics[2] as string).slice(-40)).toLowerCase();
  const token1 = ("0x" + (log.topics[3] as string).slice(-40)).toLowerCase();

  // Get block timestamp
  let deployedAt: Date | undefined;
  try {
    if (log.blockNumber) {
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      deployedAt = new Date(Number(block.timestamp) * 1000);
    }
  } catch { /* non-fatal */ }

  // Decode callbacks from address (zero RPC needed)
  const callbacks = decodeHookFlags(hookAddress);

  // Upsert hook (idempotent)
  const existing = await prisma.hook.findUnique({
    where: { address_chainId: { address: hookAddress.toLowerCase(), chainId: setup.chainId } },
  });

  const hook = await prisma.hook.upsert({
    where: { address_chainId: { address: hookAddress.toLowerCase(), chainId: setup.chainId } },
    create: {
      address: hookAddress.toLowerCase(),
      chainId: setup.chainId,
      deployedAt,
      deployTxHash: log.transactionHash ?? undefined,
      deployBlockNumber: log.blockNumber ?? undefined,
      ...callbacks,
      lastIndexedAt: new Date(),
    },
    update: { lastIndexedAt: new Date() },
  });

  // Upsert pool
  await prisma.pool.upsert({
    where: { poolId_chainId: { poolId: poolId ?? log.transactionHash ?? "", chainId: setup.chainId } },
    create: {
      poolId: poolId ?? log.transactionHash ?? "",
      hookId: hook.id,
      chainId: setup.chainId,
      token0,
      token1,
      fee,
      tickSpacing,
      deployedAt,
      deployBlockNumber: log.blockNumber ?? undefined,
    },
    update: {},
  });

  // If hook is new, queue deep analysis
  if (!existing) {
    await prisma.indexerJob.create({
      data: {
        chainId: setup.chainId,
        hookId: hook.id,
        jobType: "ANALYZE",
        status: "PENDING",
      },
    });
    return true;
  }
  return false;
}

async function enrichWithTVL(prisma: PrismaClient): Promise<void> {
  const graph = new TheGraphClient();
  const available = await graph.isAvailable();
  if (!available) {
    console.log("\n[TVL] TheGraph not available — skipping TVL enrichment");
    console.log("[TVL] To enable: add GRAPH_API_KEY to .env (free at https://thegraph.com/studio)");
    return;
  }

  console.log("\n[TVL] Fetching TVL data from TheGraph...");
  const hookTVLMap = await graph.getAllHooksWithTVL();
  console.log(`[TVL] Got data for ${hookTVLMap.size} hooks`);

  for (const [hookAddr, tvlData] of hookTVLMap) {
    const hook = await prisma.hook.findFirst({
      where: { address: hookAddr.toLowerCase() },
    });
    if (!hook) continue;

    await prisma.hookAnalytics.upsert({
      where: { hookId: hook.id },
      create: {
        hookId: hook.id,
        tvlUsd: tvlData.totalValueLockedUSD,
        volume7dUsd: 0,
        volume30dUsd: 0,
        poolCount: tvlData.poolCount,
        updatedAt: new Date(),
      },
      update: {
        tvlUsd: tvlData.totalValueLockedUSD,
        poolCount: tvlData.poolCount,
        updatedAt: new Date(),
      },
    });

    // Update pool token symbols
    for (const pool of tvlData.pools) {
      await prisma.pool.updateMany({
        where: { poolId: pool.id },
        data: {
          token0Symbol: pool.token0.symbol,
          token1Symbol: pool.token1.symbol,
          tvlUsd: parseFloat(pool.totalValueLockedUSD) || null,
        },
      });
    }
  }

  console.log("[TVL] Enrichment complete");
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║     HookScope Full Historical Backfill                ║");
  console.log("║     Finding ALL Uniswap v4 hooks on-chain             ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  const prisma = new PrismaClient();
  await prisma.$connect();

  const startTime = Date.now();

  // Scan all chains
  for (const chain of CHAINS) {
    try {
      await backfillChain(chain, prisma);
    } catch (err) {
      console.error(`[${chain.name}] Fatal error:`, err);
    }
  }

  // Enrich with TVL from TheGraph
  await enrichWithTVL(prisma);

  // Print summary
  const [hookCount, poolCount, verifiedCount] = await Promise.all([
    prisma.hook.count(),
    prisma.pool.count(),
    prisma.hook.count({ where: { isVerified: true } }),
  ]);

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║                 Backfill Complete!                    ║");
  console.log(`║  Hooks indexed  : ${String(hookCount).padEnd(33)} ║`);
  console.log(`║  Pools indexed  : ${String(poolCount).padEnd(33)} ║`);
  console.log(`║  Verified source: ${String(verifiedCount).padEnd(33)} ║`);
  console.log(`║  Time elapsed   : ${String(elapsed + 's').padEnd(33)} ║`);
  console.log("╚═══════════════════════════════════════════════════════╝");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
