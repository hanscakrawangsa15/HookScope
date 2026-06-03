import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildChainConfigs } from "./chain-config.js";
import { PoolIndexer } from "./pool-indexer.js";
import { JobWorker } from "./job-worker.js";

async function main() {
  console.log("HookScope Indexer starting...");

  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("Database connected");

  const configs = buildChainConfigs();
  if (configs.length === 0) {
    throw new Error("No chain configs found. Check your .env file.");
  }
  console.log(`Indexing ${configs.length} chain(s): ${configs.map((c) => c.chain.name).join(", ")}`);

  const worker = new JobWorker(configs, prisma);

  // Run all indexers + job worker in parallel
  await Promise.all([
    ...configs.map((config) => {
      const indexer = new PoolIndexer(config, prisma);
      return indexer.run().catch((err) => {
        console.error(`[${config.chain.name}] Indexer error:`, err);
      });
    }),
    worker.start(),
  ]);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
