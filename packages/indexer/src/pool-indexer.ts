import { parseAbiItem, type Address, type Log } from "viem";
import { PrismaClient } from "@prisma/client";
import {
  POOL_MANAGER_ABI,
  decodeHookFlags,
  isNoOpHook,
} from "@hookscope/shared";
import type { ChainConfig } from "./chain-config.js";

const INITIALIZE_EVENT = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"
);

// Process 2000 blocks at a time to avoid RPC limits
const BLOCK_CHUNK_SIZE = 2000n;

export class PoolIndexer {
  constructor(
    private readonly config: ChainConfig,
    private readonly prisma: PrismaClient
  ) {}

  async run(): Promise<void> {
    const { chain, client, poolManagerAddress } = this.config;
    console.log(`[${chain.name}] Starting indexer for PoolManager ${poolManagerAddress}`);

    const checkpoint = await this.prisma.indexerCheckpoint.findUnique({
      where: { chainId: chain.id },
    });

    const latestBlock = await client.getBlockNumber();
    // For mainnet, Uniswap v4 deployed at block ~21688400 (Jan 2025)
    const deployBlock = this.getDeployBlock(chain.id);
    const fromBlock = checkpoint
      ? checkpoint.blockNumber + 1n
      : deployBlock;

    if (fromBlock > latestBlock) {
      console.log(`[${chain.name}] Already up to date at block ${latestBlock}`);
      return;
    }

    console.log(`[${chain.name}] Scanning blocks ${fromBlock} → ${latestBlock}`);

    let currentBlock = fromBlock;
    while (currentBlock <= latestBlock) {
      const toBlock = currentBlock + BLOCK_CHUNK_SIZE - 1n < latestBlock
        ? currentBlock + BLOCK_CHUNK_SIZE - 1n
        : latestBlock;

      await this.processBlockRange(currentBlock, toBlock);
      await this.saveCheckpoint(chain.id, toBlock);

      const progress = Number(((toBlock - fromBlock) * 100n) / (latestBlock - fromBlock));
      console.log(`[${chain.name}] Progress: ${progress}% (block ${toBlock}/${latestBlock})`);

      currentBlock = toBlock + 1n;
    }

    console.log(`[${chain.name}] Indexing complete. Starting live watch...`);
    this.watchNewBlocks(latestBlock);
  }

  private async processBlockRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
    const { client, poolManagerAddress, chain } = this.config;

    const logs = await client.getLogs({
      address: poolManagerAddress,
      event: INITIALIZE_EVENT,
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      await this.processInitializeLog(log);
    }
  }

  private async processInitializeLog(log: Log): Promise<void> {
    const { chain, client } = this.config;

    const args = log.args as {
      id: `0x${string}`;
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
      sqrtPriceX96: bigint;
      tick: number;
    };

    const hookAddress = args.hooks;

    // Skip zero-address / no-op hooks
    if (isNoOpHook(hookAddress)) return;

    // Get block timestamp
    let deployedAt: Date | undefined;
    try {
      if (log.blockNumber) {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        deployedAt = new Date(Number(block.timestamp) * 1000);
      }
    } catch {
      // non-fatal
    }

    // Decode callbacks directly from address (deterministic, no RPC needed)
    const callbacks = decodeHookFlags(hookAddress);

    // Upsert hook
    const hook = await this.prisma.hook.upsert({
      where: { address_chainId: { address: hookAddress.toLowerCase(), chainId: chain.id } },
      create: {
        address: hookAddress.toLowerCase(),
        chainId: chain.id,
        deployedAt,
        deployTxHash: log.transactionHash ?? undefined,
        deployBlockNumber: log.blockNumber ?? undefined,
        ...callbacks,
        lastIndexedAt: new Date(),
      },
      update: {
        lastIndexedAt: new Date(),
      },
    });

    // Upsert pool
    await this.prisma.pool.upsert({
      where: {
        poolId_chainId: {
          poolId: args.id,
          chainId: chain.id,
        },
      },
      create: {
        poolId: args.id,
        hookId: hook.id,
        chainId: chain.id,
        token0: args.currency0.toLowerCase(),
        token1: args.currency1.toLowerCase(),
        fee: args.fee,
        tickSpacing: args.tickSpacing,
        deployedAt,
        deployBlockNumber: log.blockNumber ?? undefined,
      },
      update: {
        isActive: true,
      },
    });

    // Queue analysis jobs (non-blocking)
    await this.queueAnalysisJobs(hook.id);

    console.log(`[${chain.name}] Hook indexed: ${hookAddress} (pool: ${args.id})`);
  }

  private async queueAnalysisJobs(hookId: string): Promise<void> {
    const existing = await this.prisma.indexerJob.findFirst({
      where: { hookId, jobType: "ANALYZE", status: { in: ["PENDING", "RUNNING"] } },
    });
    if (existing) return;

    await this.prisma.indexerJob.create({
      data: {
        chainId: this.config.chain.id,
        hookId,
        jobType: "ANALYZE",
        status: "PENDING",
      },
    });
  }

  private watchNewBlocks(fromBlock: bigint): void {
    const { client, chain } = this.config;

    client.watchBlockNumber({
      onBlockNumber: async (blockNumber) => {
        try {
          await this.processBlockRange(blockNumber, blockNumber);
          await this.saveCheckpoint(chain.id, blockNumber);
        } catch (err) {
          console.error(`[${chain.name}] Error processing block ${blockNumber}:`, err);
        }
      },
      onError: (err) => {
        console.error(`[${chain.name}] Block watch error:`, err);
      },
    });
  }

  private async saveCheckpoint(chainId: number, blockNumber: bigint): Promise<void> {
    await this.prisma.indexerCheckpoint.upsert({
      where: { chainId },
      create: { chainId, blockNumber },
      update: { blockNumber, updatedAt: new Date() },
    });
  }

  private getDeployBlock(chainId: number): bigint {
    const deployBlocks: Record<number, bigint> = {
      1: 21688400n,      // Ethereum mainnet (Jan 2025)
      8453: 22817400n,   // Base
      42161: 281600000n, // Arbitrum
      10: 129200000n,    // Optimism
      11155111: 7200000n, // Sepolia
      84532: 18700000n,  // Base Sepolia
    };
    return deployBlocks[chainId] ?? 0n;
  }
}
