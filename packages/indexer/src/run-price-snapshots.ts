/**
 * Standalone, continuous price-snapshot runner — for local dev when you only
 * need the price-history/candlestick feature populated, without also running
 * the full indexer (PoolIndexer event scanning + JobWorker across every chain).
 * Run: pnpm --filter @hookscope/indexer price-snapshots
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import { PriceSnapshotService } from "./price-snapshot-service.js";

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("[PriceSnapshot] Standalone runner connected to DB");

  const service = new PriceSnapshotService(prisma);
  service.start(2 * 60 * 1000);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
