/**
 * Quick seed: insert real hooks found from on-chain scan.
 * Data diambil langsung dari Ethereum mainnet block 25233930-25238930.
 *
 * Run: pnpm --filter @hookscope/indexer seed
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

import { PrismaClient } from "@prisma/client";
import { decodeHookFlags } from "@hookscope/shared";

// Real hooks found from mainnet scan (June 2025)
// Discovered via PoolManager.Initialize events — NOT curated/submitted
const REAL_HOOKS = [
  { address: "0x6c24d0bcc264ef6a740754a11ca579b9d225e8cc", poolCount: 14, note: "High-activity swap hook with full delta returns" },
  { address: "0x0d62529346ac2c61f5c0582210d01214687bc0cc", poolCount: 5, note: "Swap delta hook" },
  { address: "0x627fa6f76fa96b10bae1b6fba280a3c9264500cc", poolCount: 3, note: "Swap delta hook" },
  { address: "0x692fa191b336af57be817f116ff9e5167de83ffb", poolCount: 1, note: "⚠️ WARNING: 13/14 callbacks active — maximum surface area" },
  { address: "0x8d12f1cb9f1dbf00a1a5e5231ca4ec29fc073acc", poolCount: 1, note: "Full lifecycle hook" },
  { address: "0xedef34db16d8c8cd874effcb5feba46b94d23acc", poolCount: 1, note: "Full lifecycle hook" },
  { address: "0x402ef98aec053aeab92322c391a10353bcbbe0c4", poolCount: 1 },
  { address: "0x89964d94bc548a8faf4615f87434abc01d9d9040", poolCount: 1 },
  { address: "0x02b1695502735af59a1305f639d283cd5c1c4144", poolCount: 1 },
  { address: "0x860721fe6bde1a03326ec35b0aa540b1442ae0cc", poolCount: 1 },
  { address: "0xbf0065c781a020466960186e37e28c590ba380c4", poolCount: 1 },
  { address: "0x383ad6dd6efe4b8df054035076ef99cf58438088", poolCount: 1 },
  { address: "0xad614dc62c51b1b55ba378693d88346d76574144", poolCount: 1 },
  { address: "0xd24fb48d67e9532cd47d8beb16bb183e8d620144", poolCount: 1 },
  { address: "0x398c5de339393221670fa275fecfad3935a58440", poolCount: 1 },
  { address: "0xf4efa169f53f1d2788699f1438fda453e147a0c4", poolCount: 1 },
  { address: "0x05ace8679d857b305ddd7c732ccda5e9cf6220c4", poolCount: 1 },
  { address: "0x3fa40993d711edf7bac55bcd30bd87afc5128440", poolCount: 1 },
  { address: "0x4cca35972819c228b3900b59fcc63ded995060c4", poolCount: 1 },
  { address: "0x5d139bd3aaa36f7cf9125969c568c8ad585320c4", poolCount: 1 },
  { address: "0x73f4499d247e5d49a33decd8c3a2b4c659ede0c4", poolCount: 1 },
  { address: "0x440529afdcde0201a5b070eb309983e4229f60c4", poolCount: 1 },
  { address: "0xaa08c3a7d30272483f89b7ab2bfebddbc4f9c040", poolCount: 1 },
  { address: "0x2877bf78beb9b7723c65f45821ecc4bd89e06444", poolCount: 1 },
  { address: "0x1e82fe8d0dd2e8a373956300980a14da51f060c4", poolCount: 1 },
  { address: "0x34c645d1bb8ea5d5460cdc5c1be6000787498080", poolCount: 1 },
  { address: "0x4ec7f7c773eff3ac6b9855ed10f611b0a783c080", poolCount: 1 },
  { address: "0x0bf79d630fcc41468e208707c906c204d7f160c4", poolCount: 1 },
];

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  console.log(`Seeding ${REAL_HOOKS.length} real hooks from Ethereum mainnet...\n`);

  let inserted = 0;
  let updated = 0;

  for (const hookData of REAL_HOOKS) {
    const addr = hookData.address.toLowerCase() as `0x${string}`;
    const callbacks = decodeHookFlags(addr);
    const flags = parseInt(addr, 16) & 0x3FFF;
    const activeCount = Object.values(callbacks).filter(Boolean).length;

    // Determine risk based on callbacks
    let riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM";
    if (activeCount >= 10) riskLevel = "CRITICAL";
    else if (activeCount >= 6) riskLevel = "HIGH";
    else if (activeCount >= 3) riskLevel = "MEDIUM";
    else riskLevel = "LOW";

    // Score: start 70, penalize for unverified (-30) and delta returns
    let score = 70;
    if (callbacks.beforeSwapReturnsDelta || callbacks.afterSwapReturnsDelta) score -= 10;
    if (callbacks.afterAddLiquidityReturnsDelta || callbacks.afterRemoveLiquidityReturnsDelta) score -= 10;
    score = Math.max(10, score);

    const existing = await prisma.hook.findUnique({
      where: { address_chainId: { address: addr, chainId: 1 } },
    });

    const hookRecord = await prisma.hook.upsert({
      where: { address_chainId: { address: addr, chainId: 1 } },
      create: {
        address: addr,
        chainId: 1,
        description: hookData.note ?? null,
        isVerified: false,
        proxyType: "NONE",
        ...callbacks,
        riskLevel,
        hookScore: score,
        auditStatus: "UNAUDITED",
        lastIndexedAt: new Date(),
      },
      update: {
        description: hookData.note ?? undefined,
        riskLevel,
        hookScore: score,
        lastIndexedAt: new Date(),
      },
    });

    // Upsert analytics
    await prisma.hookAnalytics.upsert({
      where: { hookId: hookRecord.id },
      create: { hookId: hookRecord.id, poolCount: hookData.poolCount, updatedAt: new Date() },
      update: { poolCount: hookData.poolCount, updatedAt: new Date() },
    });

    if (existing) updated++; else inserted++;

    const cbList = Object.entries(callbacks)
      .filter(([,v]) => v)
      .map(([k]) => k.replace(/([A-Z])/g, ' $1').trim())
      .join(", ");

    console.log(`${existing ? '↺' : '+'} ${addr}`);
    console.log(`  Risk: ${riskLevel} | Score: ${score} | Callbacks (${activeCount}): ${cbList || 'none'}`);
    if (hookData.note) console.log(`  Note: ${hookData.note}`);
    console.log();
  }

  const [total, pools] = await Promise.all([
    prisma.hook.count(),
    prisma.pool.count(),
  ]);

  console.log(`\n✅ Done! Inserted: ${inserted} | Updated: ${updated}`);
  console.log(`   Total hooks in DB: ${total}`);
  console.log(`\n🌐 Open http://localhost:3000 to see them!`);

  await prisma.$disconnect();
}

main().catch(console.error);
